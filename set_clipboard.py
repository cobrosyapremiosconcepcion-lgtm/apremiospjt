import sys
import json
import ctypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]

GMEM_MOVEABLE = 0x0002
CF_UNICODETEXT = 13
CF_RTF = user32.RegisterClipboardFormatW("Rich Text Format")
CF_HTML = user32.RegisterClipboardFormatW("HTML Format")

def format_html_for_clipboard(html_fragment):
    # Windows CF_HTML specification
    header = (
        "Version:0.9\r\n"
        "StartHTML:{:08d}\r\n"
        "EndHTML:{:08d}\r\n"
        "StartFragment:{:08d}\r\n"
        "EndFragment:{:08d}\r\n"
    )
    pre = "<html><body><!--StartFragment-->"
    post = "<!--EndFragment--></body></html>"
    
    # Calculate offsets
    dummy_header = header.format(0, 0, 0, 0)
    start_html = len(dummy_header.encode('utf-8'))
    start_frag = start_html + len(pre.encode('utf-8'))
    end_frag = start_frag + len(html_fragment.encode('utf-8'))
    end_html = end_frag + len(post.encode('utf-8'))
    
    final_header = header.format(start_html, end_html, start_frag, end_frag)
    return (final_header + pre + html_fragment + post).encode('utf-8')

def set_clipboard(rtf_text=None, plain_text=None, html_text=None):
    if not user32.OpenClipboard(None):
        return False
    user32.EmptyClipboard()
    
    # 1. RTF (Vital para SAE / JWord)
    if rtf_text:
        rtf_bytes = rtf_text.encode('latin1', errors='replace') + b'\x00'
        h_rtf = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(rtf_bytes))
        p_rtf = kernel32.GlobalLock(h_rtf)
        ctypes.memmove(p_rtf, rtf_bytes, len(rtf_bytes))
        kernel32.GlobalUnlock(h_rtf)
        user32.SetClipboardData(CF_RTF, h_rtf)

    # 2. CF_HTML (Para Word / Docs / Navegadores)
    if html_text:
        cf_html_bytes = format_html_for_clipboard(html_text) + b'\x00'
        h_html = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(cf_html_bytes))
        p_html = kernel32.GlobalLock(h_html)
        ctypes.memmove(p_html, cf_html_bytes, len(cf_html_bytes))
        kernel32.GlobalUnlock(h_html)
        user32.SetClipboardData(CF_HTML, h_html)

    # 3. Unicode Plain Text (Para Excel, Notepad, etc.)
    if plain_text:
        u_bytes = (plain_text + '\x00').encode('utf-16le')
        h_u = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(u_bytes))
        p_u = kernel32.GlobalLock(h_u)
        ctypes.memmove(p_u, u_bytes, len(u_bytes))
        kernel32.GlobalUnlock(h_u)
        user32.SetClipboardData(CF_UNICODETEXT, h_u)

    user32.CloseClipboard()
    return True

if __name__ == '__main__':
    try:
        if hasattr(sys.stdin, 'reconfigure'):
            sys.stdin.reconfigure(encoding='utf-8')
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input)
        rtf = payload.get('rtf')
        plain = payload.get('plain')
        html = payload.get('html')
        success = set_clipboard(rtf, plain, html)
        print(json.dumps({'success': success}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
