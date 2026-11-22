// roadmap-export: signed links (30 days) for a built roadmap in the private roadmap-decks bucket.
// POST {"request_id", "secret"}                      -> {pptx: {url, bytes, filename}, pdf: {...}}; links saved in roadmap_files.meta.url
// POST {"action":"upload", "request_id", "secret", "files":[{kind, filename}]}
//                                                     -> {kind: {path, token, signed_url}}: the builder PUTs each file there directly
// POST {"action":"video_slot"|"video_done", ...}         -> server-made video upload (roadmap-videos), then status video_ready
// Older builds keep their bytes in roadmap_files.bytes (hex); those are copied to the bucket first.
import { createClient } from "jsr:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "roadmap-decks";
const TYPES: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", pdf: "application/pdf" };
function hex(s: string) {
  const h = s.startsWith("\\x") ? s.slice(2) : s;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { data: ps } = await sb.from("pr_settings").select("engine_secret").eq("id", 1).single();
  if (!body.secret || body.secret !== ps?.engine_secret) return new Response("unauthorized", { status: 401 });
  const id = body.request_id;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) return new Response("request_id required", { status: 400 });

  // the server-made video: an upload slot in roadmap-videos, then "done" records it (status video_ready)
  if (body.action === "video_slot") {
    const path = `${id}/roadmap_${Date.now()}.mp4`;
    const { data, error } = await sb.storage.from("roadmap-videos").createSignedUploadUrl(path);
    return error ? json({ error: error.message }, 500) : json({ path, token: data.token, signed_url: data.signedUrl });
  }
  if (body.action === "video_done") {
    const path = String(body.path ?? "");
    if (!path.startsWith(id + "/")) return json({ error: "bad path" }, 400);
    const { data: ls } = await sb.storage.from("roadmap-videos").list(id, { search: path.split("/")[1] });
    if (!(ls ?? []).some((o: any) => `${id}/${o.name}` === path)) return json({ error: "video not found" }, 400);
    const { data: r } = await sb.from("roadmap_requests").select("status,video_path").eq("id", id).single();
    const now = new Date().toISOString();
    await sb.from("roadmap_requests").update({ video_path: path, video_at: now, updated_at: now,
      status: r?.status === "ready_to_export" ? "video_ready" : r?.status }).eq("id", id);
    if (r?.video_path && r.video_path !== path) await sb.storage.from("roadmap-videos").remove([r.video_path]);
    return json({ ok: true, path });
  }

  if (body.action === "upload") {
    const out: Record<string, unknown> = {};
    for (const f of body.files ?? []) {
      const name = String(f.filename ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${id}/${name}`;
      await sb.storage.from(BUCKET).remove([path]);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
      out[f.kind] = error ? { error: error.message } : { path, token: data.token, signed_url: data.signedUrl };
    }
    return json(out);
  }

  const { data: files, error } = await sb.from("roadmap_files").select("kind,filename,bytes,path,meta").eq("request_id", id);
  if (error) return new Response(error.message, { status: 500 });
  const out: Record<string, unknown> = {};
  for (const f of files ?? []) {
    let path = f.path as string | null;
    let size = (f.meta?.size as number) ?? null;
    if (!path) {
      const bytes = hex(f.bytes as string);
      path = `${id}/${f.filename}`;
      const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: TYPES[f.kind] ?? "application/octet-stream", upsert: true });
      if (up.error) { out[f.kind] = { error: up.error.message }; continue; }
      size = bytes.length;
    }
    const { data: sg } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30, { download: f.filename });
    out[f.kind] = { url: sg?.signedUrl, bytes: size, filename: f.filename };
    await sb.from("roadmap_files").update({ path, meta: { ...(f.meta ?? {}), url: sg?.signedUrl, exported_at: new Date().toISOString() } })
      .eq("request_id", id).eq("kind", f.kind);
  }
  return json(out);
});
