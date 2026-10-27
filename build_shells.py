# Generates index.html (Health log icon) and today/index.html (Today icon). Run after editing.
THEME = """<script>(function(){var t='auto';try{t=JSON.parse(localStorage.getItem('hq.theme')||'"auto"')}catch(e){}var d=t==='dark'||(t==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';var m=document.querySelector('meta[name=theme-color]');if(m)m.content=d?'#000000':'#ffffff'})()</script>"""
ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
TABS = f"""<nav id="tabbar" aria-label="Sections">
<button type="button" data-tab="today">{ICON}<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>Today</button>
<button type="button" data-tab="ahead">{ICON}<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>Ahead</button>
<button type="button" data-tab="money">{ICON}<path d="M16 7.2A3.6 3.6 0 0 0 9.4 9v10M6.5 13.5h7M6.5 19h11"/></svg>Money</button>
<button type="button" data-tab="log">{ICON}<path d="M12 5v14M5 12h14"/></svg>Health log</button>
</nav>"""
def shell(start, base, title):
    return f"""<!doctype html>
<html lang="en" data-start="{start}" data-base="{base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="{title}">
<meta name="referrer" content="no-referrer">
<title>{title}</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" href="icon-192.png">
{THEME}
<link rel="stylesheet" href="{base}app.css">
</head>
<body>
<main id="today-view" class="view tv" hidden></main>
<main id="ahead-view" class="view tv" hidden></main>
<main id="money-view" class="view tv" hidden></main>
<main id="log-view" class="view lv" hidden></main>
<main id="settings-view" class="view sv" hidden></main>
{TABS}
<div id="toast" role="status" aria-live="polite" hidden><span id="toast-text"></span><button id="toast-btn" type="button" hidden>Undo</button></div>
<div id="reward" class="reward" role="status" aria-live="polite" hidden></div>
<script src="{base}app.js"></script>
</body>
</html>
"""
open('index.html', 'w').write(shell('log', './', 'Health log'))
open('today/index.html', 'w').write(shell('today', '../', 'Today'))
