import re
def split(text):
    """Split SQL text into top-level statements. Returns list of (start_line, stmt_text_with_comments, code_only)."""
    out=[]; i=0; n=len(text); start=0; buf_code=[]
    line=1; start_line=None
    def emit(end):
        nonlocal start, buf_code, start_line
        s=text[start:end]; code=''.join(buf_code)
        if code.strip():
            out.append((start_line, s, code))
        start=end; buf_code=[]; start_line=None
    while i<n:
        c=text[i]
        if c=='\n': line+=1
        if text.startswith('--',i):
            j=text.find('\n',i);  j=n if j<0 else j
            buf_code.append(' '); i=j; continue
        if text.startswith('/*',i):
            depth=1; j=i+2
            while j<n and depth:
                if text.startswith('/*',j): depth+=1; j+=2
                elif text.startswith('*/',j): depth-=1; j+=2
                else:
                    if text[j]=='\n': line+=1
                    j+=1
            buf_code.append(' '); i=j; continue
        if not c.isspace() and start_line is None: start_line=line
        if c=="'":
            esc = i>0 and text[i-1] in 'eE' and (i<2 or not (text[i-2].isalnum() or text[i-2]=='_'))
            j=i+1
            while j<n:
                if esc and text[j]=='\\': j+=2; continue
                if text[j]=="'":
                    if j+1<n and text[j+1]=="'": j+=2; continue
                    break
                j+=1
            seg=text[i:j+1]; line+=seg.count('\n'); buf_code.append(seg); i=j+1; continue
        if c=='"':
            j=text.find('"',i+1)
            while j+1<n and text[j+1]=='"': j=text.find('"',j+2)
            seg=text[i:j+1]; line+=seg.count('\n'); buf_code.append(seg); i=j+1; continue
        if c=='$':
            m=re.match(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$',text[i:])
            if m and not (i>0 and (text[i-1].isalnum() or text[i-1]=='_')):
                tag=m.group(0); j=text.find(tag,i+len(tag))
                if j<0: raise ValueError('unterminated dollar quote at line %d'%line)
                seg=text[i:j+len(tag)]; line+=seg.count('\n'); buf_code.append(seg); i=j+len(tag); continue
        if c==';':
            buf_code.append(';'); i+=1; emit(i); continue
        buf_code.append(c); i+=1
    emit(n)
    return out
