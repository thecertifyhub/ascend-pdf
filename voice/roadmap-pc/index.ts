// roadmap-pc: the PowerPoint export script on Christian's PC (G:\My Drive\Roadmaps\Export_Roadmaps.bat).
// Every call carries {"key": <roadmap_machine_settings.pc_export_key>}. The key can only do what is below.
// POST {"action":"list"}                        -> roadmaps built and not yet exported by PowerPoint (not tests):
//                                                  folder name, file base name, signed PPTX and PDF links (2 hours)
// POST {"action":"video_slot", "request_id"}    -> an upload slot in roadmap-videos for the exported MP4
// POST {"action":"video_start", "request_id", "size"} -> a resumable upload; then the raw 6 MB chunks are POSTed with
//                                                  headers x-key, x-upload-url, x-chunk-offset
// POST {"action":"video_done", "request_id", "path"} -> the page now plays that video (status video_ready)
import { createClient } from "jsr:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const plain = (s: string) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

const TUS = "https://jbncsigalbtfwkxpgwso.storage.supabase.co/storage/v1/upload/resumable";
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const tusHeaders = { "Tus-Resumable": "1.0.0", apikey: SVC, authorization: `Bearer ${SVC}` };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { data: s } = await sb.from("roadmap_machine_settings").select("pc_export_key").eq("id", 1).single();

  // a 6 MB chunk of the video (raw body): forwarded to the resumable upload created by "video_start".
  // Large videos go up in chunks because a single upload is cut off near 100 MB.
  if (req.headers.get("x-chunk-offset") !== null) {
    if (!s?.pc_export_key || req.headers.get("x-key") !== s.pc_export_key) return json({ error: "unauthorized" }, 401);
    const url = req.headers.get("x-upload-url") ?? "";
    if (!url.startsWith(TUS + "/")) return json({ error: "bad upload url" }, 400);
    const body = new Uint8Array(await req.arrayBuffer());
    const p = await fetch(url, { method: "PATCH", body, headers: { ...tusHeaders, "Upload-Offset": req.headers.get("x-chunk-offset")!,
      "Content-Type": "application/offset+octet-stream" } });
    const t = await p.text();
    if (p.status >= 300) return json({ error: `chunk ${p.status}: ${t.slice(0, 200)}` }, 502);
    return json({ offset: Number(p.headers.get("upload-offset")) });
  }

  const b = await req.json().catch(() => ({}));
  if (!b.key || !s?.pc_export_key || b.key !== s.pc_export_key) return json({ error: "unauthorized" }, 401);

  if (b.action === "list") {
    const { data: rs } = await sb.from("roadmap_requests").select("id,first_name,last_name,language,status,built_at")
      .in("status", ["ready_to_export", "video_ready"]).is("pc_video_at", null).neq("source", "test").order("created_at");
    const items = [];
    for (const r of rs ?? []) {
      const { data: files } = await sb.from("roadmap_files").select("kind,path,filename").eq("request_id", r.id);
      const f: Record<string, any> = {};
      for (const x of files ?? []) if (x.path) f[x.kind] = x;
      if (!f.pptx || !f.pdf) continue;
      const sign = async (x: any) => (await sb.storage.from("roadmap-decks").createSignedUrl(x.path, 7200)).data?.signedUrl;
      const base = String(f.pptx.filename).replace(/\.pptx$/i, "");
      items.push({ id: r.id, name: `${r.first_name} ${r.last_name}`, language: r.language,
        folder: `${plain(r.last_name)}_${plain(String(r.first_name).split(/\s+/)[0])}`, base, built_at: r.built_at,
        pptx_url: await sign(f.pptx), pdf_url: await sign(f.pdf) });
    }
    return json({ items });
  }

  const id = b.request_id;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) return json({ error: "request_id required" }, 400);
  if (b.action === "video_slot") {
    const path = `${id}/roadmap_pc_${Date.now()}.mp4`;
    const { data, error } = await sb.storage.from("roadmap-videos").createSignedUploadUrl(path);
    return error ? json({ error: error.message }, 500) : json({ path, signed_url: data.signedUrl });
  }
  if (b.action === "video_start") {
    // a resumable upload for the whole file; the script then sends it in 6 MB chunks (see above)
    const size = Number(b.size);
    if (!(size > 0)) return json({ error: "size required" }, 400);
    const path = `${id}/roadmap_pc_${Date.now()}.mp4`;
    const meta = `bucketName ${btoa("roadmap-videos")},objectName ${btoa(path)},contentType ${btoa("video/mp4")}`;
    const c = await fetch(TUS, { method: "POST", headers: { ...tusHeaders, "Upload-Length": String(size), "Upload-Metadata": meta, "x-upsert": "true" } });
    const loc = c.headers.get("location"); const t = await c.text();
    if (!loc) return json({ error: `start ${c.status}: ${t.slice(0, 200)}` }, 502);
    return json({ path, upload_url: loc, chunk: 6 * 1024 * 1024 });
  }
  if (b.action === "video_done") {
    const path = String(b.path ?? "");
    if (!path.startsWith(id + "/")) return json({ error: "bad path" }, 400);
    const { data: ls } = await sb.storage.from("roadmap-videos").list(id, { search: path.split("/")[1] });
    const obj = (ls ?? []).find((o: any) => `${id}/${o.name}` === path);
    if (!obj) return json({ error: "video not found" }, 400);
    const now = new Date().toISOString();
    const { data: r } = await sb.from("roadmap_requests").select("status").eq("id", id).single();
    await sb.from("roadmap_requests").update({ video_path: path, video_at: now, pc_video_at: now, updated_at: now,
      status: r?.status === "ready_to_export" ? "video_ready" : r?.status }).eq("id", id);
    return json({ ok: true, mb: Math.round((obj.metadata?.size ?? 0) / 1048576) });
  }
  return json({ error: "unknown action" }, 400);
});
