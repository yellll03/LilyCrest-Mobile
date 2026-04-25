from __future__ import annotations

import base64
import html
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANUAL_MD = ROOT / "LILYCREST_USER_MANUAL.md"
MANUAL_HTML = ROOT / "LILYCREST_USER_MANUAL.html"
MANUAL_PDF = ROOT / "LILYCREST_USER_MANUAL.pdf"
WORDMARK = ROOT / "frontend" / "assets" / "images" / "lilycrest-wordmark.png"
ASSISTANT = ROOT / "frontend" / "assets" / "images" / "lily-assistant.png"

EDGE_CANDIDATES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
]

PAGE_BREAK_TITLES = {
    "Main Navigation",
    "How to Use Lily Assistant",
    "Quick Troubleshooting",
}


def image_data_uri(path: Path) -> str:
    suffix = path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "section"


def inline_format(text: str) -> str:
    parts = re.split(r"(`[^`]+`)", text)
    rendered = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) >= 2:
            rendered.append(f"<code>{html.escape(part[1:-1])}</code>")
        else:
            rendered.append(html.escape(part))
    return "".join(rendered)


def flush_paragraph(paragraph_lines: list[str], blocks: list[dict]) -> None:
    if not paragraph_lines:
        return
    text = " ".join(line.strip() for line in paragraph_lines if line.strip())
    if text:
        blocks.append({"type": "p", "text": text})
    paragraph_lines.clear()


def flush_list(items: list[str], list_type: str | None, blocks: list[dict]) -> None:
    if not items or not list_type:
        items.clear()
        return
    blocks.append({"type": list_type, "items": items[:]})
    items.clear()


def parse_markdown(content: str) -> tuple[str, str, list[dict]]:
    title = "LilyCrest User Manual"
    subtitle = ""
    sections: list[dict] = []
    current_section: dict | None = None
    paragraph_lines: list[str] = []
    list_items: list[str] = []
    list_type: str | None = None

    def flush_pending() -> None:
        nonlocal list_type
        if current_section is None:
            return
        flush_paragraph(paragraph_lines, current_section["blocks"])
        flush_list(list_items, list_type, current_section["blocks"])
        list_type = None

    for raw_line in content.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("# "):
            title = stripped[2:].strip() or title
            continue

        if stripped.startswith("## "):
            flush_pending()
            current_section = {
                "title": stripped[3:].strip(),
                "slug": slugify(stripped[3:].strip()),
                "blocks": [],
            }
            sections.append(current_section)
            continue

        if current_section is None:
            if stripped:
                subtitle = stripped
            continue

        if stripped.startswith("### "):
            flush_pending()
            current_section["blocks"].append({"type": "h3", "text": stripped[4:].strip()})
            continue

        bullet_match = re.match(r"^- (.+)", stripped)
        ordered_match = re.match(r"^\d+\.\s+(.+)", stripped)

        if bullet_match:
            flush_paragraph(paragraph_lines, current_section["blocks"])
            if list_type not in (None, "ul"):
                flush_list(list_items, list_type, current_section["blocks"])
                list_type = None
            list_type = "ul"
            list_items.append(bullet_match.group(1).strip())
            continue

        if ordered_match:
            flush_paragraph(paragraph_lines, current_section["blocks"])
            if list_type not in (None, "ol"):
                flush_list(list_items, list_type, current_section["blocks"])
                list_type = None
            list_type = "ol"
            list_items.append(ordered_match.group(1).strip())
            continue

        if not stripped:
            flush_paragraph(paragraph_lines, current_section["blocks"])
            flush_list(list_items, list_type, current_section["blocks"])
            list_type = None
            continue

        if list_items:
            flush_list(list_items, list_type, current_section["blocks"])
            list_type = None

        paragraph_lines.append(stripped)

    flush_pending()
    return title, subtitle, sections


def render_block(block: dict) -> str:
    if block["type"] == "p":
        return f"<p>{inline_format(block['text'])}</p>"
    if block["type"] == "h3":
        return f"<h3>{inline_format(block['text'])}</h3>"
    if block["type"] in {"ul", "ol"}:
        items = "".join(f"<li>{inline_format(item)}</li>" for item in block["items"])
        return f"<{block['type']}>{items}</{block['type']}>"
    return ""


def build_html(title: str, subtitle: str, sections: list[dict]) -> str:
    wordmark_src = image_data_uri(WORDMARK)
    assistant_src = image_data_uri(ASSISTANT)
    toc_items = "".join(
        f'<a href="#{section["slug"]}" class="toc-item"><span>{html.escape(section["title"])}</span><span class="toc-arrow">></span></a>'
        for section in sections
    )

    section_html = []
    for section in sections:
        section_classes = ["manual-card"]
        if section["title"] in PAGE_BREAK_TITLES:
            section_classes.append("page-break-before")
        if section["title"] == "Quick Troubleshooting":
            section_classes.append("troubleshooting")
        if section["title"] == "One-Minute Summary":
            section_classes.append("summary-card")

        blocks_html = "".join(render_block(block) for block in section["blocks"])
        section_html.append(
            f"""
            <section id="{section["slug"]}" class="{' '.join(section_classes)}">
              <div class="section-topbar"></div>
              <h2>{html.escape(section["title"])}</h2>
              <div class="section-content">
                {blocks_html}
              </div>
            </section>
            """
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    @page {{
      size: A4;
      margin: 14mm;
    }}

    :root {{
      --navy: #14365A;
      --navy-2: #1E3A5F;
      --navy-3: #0F2338;
      --orange: #D4682A;
      --gold: #F2B544;
      --ink: #0F172A;
      --muted: #64748B;
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --line: #E2E8F0;
      --soft: #FDF6EC;
      --soft-blue: #EFF6FF;
      --success: #ECFDF3;
    }}

    * {{
      box-sizing: border-box;
    }}

    html {{
      background: var(--bg);
    }}

    body {{
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: linear-gradient(180deg, #F8FAFC 0%, #FFFDF8 100%);
    }}

    .cover {{
      min-height: 260mm;
      background:
        radial-gradient(circle at top right, rgba(242, 181, 68, 0.18), transparent 30%),
        linear-gradient(145deg, var(--navy-3) 0%, var(--navy) 52%, var(--navy-2) 100%);
      border-radius: 28px;
      overflow: hidden;
      position: relative;
      padding: 28px;
      color: #fff;
      page-break-after: always;
      box-shadow: 0 22px 48px rgba(15, 23, 42, 0.18);
    }}

    .cover::after {{
      content: "";
      position: absolute;
      inset: auto -50px -50px auto;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      filter: blur(8px);
    }}

    .cover-brand {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      gap: 16px;
    }}

    .cover-brand img {{
      width: 240px;
      max-width: 60%;
      height: auto;
    }}

    .guide-chip {{
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(212, 104, 42, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}

    .cover-grid {{
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 24px;
      align-items: center;
    }}

    .eyebrow {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: #E2E8F0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}

    .eyebrow::before {{
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--orange);
    }}

    .cover h1 {{
      font-size: 42px;
      line-height: 1.08;
      margin: 18px 0 12px;
      letter-spacing: -0.04em;
    }}

    .cover p {{
      margin: 0;
      color: #DBE7F2;
      font-size: 16px;
      line-height: 1.7;
      max-width: 520px;
    }}

    .cover-pills {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }}

    .cover-pill {{
      padding: 10px 14px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #F8FAFC;
      font-size: 13px;
      font-weight: 600;
    }}

    .assistant-shell {{
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 28px;
      padding: 22px;
      backdrop-filter: blur(8px);
      text-align: center;
    }}

    .assistant-frame {{
      width: 210px;
      height: 210px;
      margin: 0 auto 16px;
      border-radius: 38px;
      background: linear-gradient(180deg, #091A33 0%, #102C49 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }}

    .assistant-frame img {{
      width: 172px;
      height: 172px;
      object-fit: contain;
    }}

    .assistant-shell h3 {{
      margin: 0 0 8px;
      font-size: 20px;
      color: #fff;
    }}

    .assistant-shell p {{
      font-size: 14px;
      line-height: 1.6;
      color: #D5E2EE;
      margin: 0;
    }}

    .quick-start-page {{
      page-break-after: always;
      min-height: 250mm;
      padding: 6px 2px 0;
    }}

    .page-topbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding: 14px 18px;
      border-radius: 22px;
      background: linear-gradient(180deg, rgba(20,54,90,0.06) 0%, rgba(20,54,90,0.02) 100%);
      border: 1px solid var(--line);
    }}

    .page-topbar h2 {{
      margin: 0;
      font-size: 24px;
      color: var(--navy-2);
      letter-spacing: -0.03em;
    }}

    .page-topbar p {{
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 14px;
    }}

    .badge {{
      padding: 10px 14px;
      border-radius: 14px;
      background: var(--soft);
      color: var(--orange);
      font-size: 12px;
      font-weight: 700;
    }}

    .quick-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }}

    .quick-card {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
    }}

    .quick-step {{
      width: 40px;
      height: 40px;
      border-radius: 14px;
      background: linear-gradient(180deg, var(--orange) 0%, #E0793A 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 14px;
    }}

    .quick-card h3 {{
      margin: 0 0 8px;
      color: var(--navy-2);
      font-size: 18px;
    }}

    .quick-card p {{
      margin: 0;
      color: var(--muted);
      line-height: 1.7;
      font-size: 14px;
    }}

    .tabs-panel {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
      margin-bottom: 18px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
    }}

    .tabs-panel h3 {{
      margin: 0 0 12px;
      color: var(--navy-2);
      font-size: 18px;
    }}

    .tab-pills {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }}

    .tab-pill {{
      padding: 12px 16px;
      border-radius: 18px;
      background: linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%);
      border: 1px solid var(--line);
      font-size: 13px;
      font-weight: 700;
      color: var(--navy-2);
    }}

    .highlight-box {{
      background: linear-gradient(180deg, rgba(212,104,42,0.10) 0%, rgba(212,104,42,0.04) 100%);
      border: 1px solid rgba(212, 104, 42, 0.18);
      border-radius: 22px;
      padding: 18px;
      color: var(--ink);
    }}

    .highlight-box strong {{
      color: var(--navy-2);
    }}

    .toc-page {{
      page-break-after: always;
    }}

    .toc-card {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 24px;
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
    }}

    .toc-card h2 {{
      margin: 0 0 8px;
      color: var(--navy-2);
      font-size: 28px;
    }}

    .toc-card p {{
      margin: 0 0 18px;
      color: var(--muted);
      line-height: 1.7;
    }}

    .toc-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }}

    .toc-item {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      background: linear-gradient(180deg, #FFFFFF 0%, #FAFBFD 100%);
      border: 1px solid var(--line);
      border-radius: 18px;
      color: var(--ink);
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }}

    .toc-arrow {{
      color: var(--orange);
      font-weight: 800;
    }}

    .content-stack {{
      display: flex;
      flex-direction: column;
      gap: 18px;
    }}

    .manual-card {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 16px 32px rgba(15, 23, 42, 0.06);
      break-inside: avoid;
    }}

    .page-break-before {{
      break-before: page;
    }}

    .section-topbar {{
      height: 12px;
      background: linear-gradient(90deg, var(--navy) 0%, var(--orange) 100%);
    }}

    .manual-card h2 {{
      margin: 0;
      padding: 22px 24px 0;
      color: var(--navy-2);
      font-size: 26px;
      letter-spacing: -0.04em;
    }}

    .section-content {{
      padding: 16px 24px 24px;
    }}

    .section-content h3 {{
      margin: 18px 0 8px;
      color: var(--ink);
      font-size: 18px;
    }}

    .section-content p {{
      margin: 0 0 12px;
      color: #334155;
      font-size: 14px;
      line-height: 1.8;
    }}

    .section-content code {{
      font-family: "Consolas", "Courier New", monospace;
      padding: 2px 7px;
      border-radius: 8px;
      background: var(--soft-blue);
      color: var(--navy-2);
      font-size: 12px;
      font-weight: 700;
    }}

    .section-content ul,
    .section-content ol {{
      margin: 10px 0 16px;
      padding: 0;
      list-style: none;
    }}

    .section-content ul li,
    .section-content ol li {{
      position: relative;
      margin: 0 0 10px;
      padding: 10px 12px 10px 46px;
      border-radius: 16px;
      background: linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%);
      border: 1px solid #E8EEF5;
      color: #334155;
      line-height: 1.65;
      break-inside: avoid;
    }}

    .section-content ul li::before {{
      content: "";
      position: absolute;
      left: 16px;
      top: 17px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--orange);
      box-shadow: 0 0 0 4px rgba(212, 104, 42, 0.14);
    }}

    .section-content ol {{
      counter-reset: step;
    }}

    .section-content ol li::before {{
      counter-increment: step;
      content: counter(step);
      position: absolute;
      left: 11px;
      top: 10px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--navy-2);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
    }}

    .troubleshooting {{
      background:
        linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,247,237,0.96) 100%);
    }}

    .summary-card {{
      background:
        linear-gradient(180deg, rgba(20,54,90,0.04) 0%, rgba(212,104,42,0.06) 100%);
    }}

    .footer-note {{
      margin-top: 14px;
      text-align: center;
      color: var(--muted);
      font-size: 11px;
    }}

    @media print {{
      body {{
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
    }}
  </style>
</head>
<body>
  <div class="cover">
    <div class="cover-brand">
      <img src="{wordmark_src}" alt="LilyCrest logo" />
      <div class="guide-chip">Tenant User Guide</div>
    </div>

    <div class="cover-grid">
      <div>
        <div class="eyebrow">Simple and Fast</div>
        <h1>{html.escape(title)}</h1>
        <p>{html.escape(subtitle)}</p>
        <div class="cover-pills">
          <div class="cover-pill">Bills and Payments</div>
          <div class="cover-pill">Maintenance Requests</div>
          <div class="cover-pill">Documents</div>
          <div class="cover-pill">Lily Assistant</div>
          <div class="cover-pill">Announcements</div>
        </div>
      </div>

      <div class="assistant-shell">
        <div class="assistant-frame">
          <img src="{assistant_src}" alt="Lily Assistant" />
        </div>
        <h3>Designed Like the App</h3>
        <p>This PDF uses LilyCrest's colors, rounded cards, and assistant style so the guide feels familiar the moment a user opens it.</p>
      </div>
    </div>
  </div>

  <section class="quick-start-page">
    <div class="page-topbar">
      <div>
        <h2>Quick Start</h2>
        <p>These are the first things every user should do.</p>
      </div>
      <div class="badge">Best for first-time users</div>
    </div>

    <div class="quick-grid">
      <article class="quick-card">
        <div class="quick-step">01</div>
        <h3>Install the APK</h3>
        <p>Download the Android APK, allow installation if prompted, and open LilyCrest after it finishes.</p>
      </article>
      <article class="quick-card">
        <div class="quick-step">02</div>
        <h3>Sign In</h3>
        <p>Use your tenant account through email and password, Google sign-in, or biometrics if already enabled.</p>
      </article>
      <article class="quick-card">
        <div class="quick-step">03</div>
        <h3>Use the Main Tabs</h3>
        <p>Start with Home for your dashboard, then move to Billings, Services, Announcements, and Profile as needed.</p>
      </article>
      <article class="quick-card">
        <div class="quick-step">04</div>
        <h3>Ask Lily for Help</h3>
        <p>If you need help quickly, open Lily Assistant. It can answer questions or connect you to an admin.</p>
      </article>
    </div>

    <div class="tabs-panel">
      <h3>Main Tabs</h3>
      <div class="tab-pills">
        <div class="tab-pill">Services</div>
        <div class="tab-pill">Announcements</div>
        <div class="tab-pill">Home</div>
        <div class="tab-pill">Billings</div>
        <div class="tab-pill">Profile</div>
      </div>
    </div>

    <div class="highlight-box">
      <strong>Tip:</strong> If the app opens but cannot load announcements, bills, or profile data, the internet connection may be weak or the test server may be offline.
    </div>
  </section>

  <section class="toc-page">
    <div class="toc-card">
      <h2>Contents</h2>
      <p>Jump to any part of the guide below. Each section is written in simple steps so users can understand the app immediately.</p>
      <div class="toc-grid">
        {toc_items}
      </div>
    </div>
  </section>

  <main class="content-stack">
    {''.join(section_html)}
  </main>

  <div class="footer-note">LilyCrest Tenant Portal Manual</div>
</body>
</html>
"""


def write_html() -> None:
    content = MANUAL_MD.read_text(encoding="utf-8")
    title, subtitle, sections = parse_markdown(content)
    html_output = build_html(title, subtitle, sections)
    MANUAL_HTML.write_text(html_output, encoding="utf-8")


def browser_path() -> Path:
    for candidate in EDGE_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No supported browser found for PDF generation.")


def render_pdf() -> None:
    browser = browser_path()
    html_uri = MANUAL_HTML.resolve().as_uri()
    with tempfile.TemporaryDirectory(prefix="lilycrest-manual-") as temp_dir:
        user_data_dir = Path(temp_dir) / "profile"
        user_data_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(browser),
            "--headless=new",
            "--disable-gpu",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=12000",
            f"--user-data-dir={user_data_dir}",
            "--print-to-pdf-no-header",
            f"--print-to-pdf={MANUAL_PDF}",
            html_uri,
        ]
        subprocess.run(command, check=True)


def main() -> None:
    write_html()
    render_pdf()
    print(f"HTML generated: {MANUAL_HTML}")
    print(f"PDF generated: {MANUAL_PDF}")


if __name__ == "__main__":
    main()
