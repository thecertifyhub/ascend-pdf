# Builds the two hosted pages from their sources: the inline script is made 7-bit ASCII (\u escapes).
import re, subprocess, sys
for src, out in [("roadmap_page.src.html", "index.html"), ("request/request.src.html", "request/index.html")]:
    s = open(src).read()
    esc = lambda m: "".join(c if ord(c) < 128 else "\\u%04x" % ord(c) for c in m.group(0))
    s = re.sub(r"<script>[\s\S]*?</script>", esc, s)
    js = re.search(r"<script>([\s\S]*?)</script>", s).group(1)
    assert all(ord(c) < 128 for c in js) and "—" not in s
    open("/tmp/_chk.js", "w").write(js)
    subprocess.run(["node", "--check", "/tmp/_chk.js"], check=True)
    open(out, "w").write(s); print(out, len(s))
