import sys
import json
import os
import re
import warnings
warnings.filterwarnings("ignore")

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]
    cookies_path = sys.argv[2] if len(sys.argv) > 2 else None

    if cookies_path and os.path.exists(cookies_path):
        size = os.path.getsize(cookies_path)
        print(f"🍪 Cookies: {size} bytes", file=sys.stderr)
    else:
        cookies_path = None
        print("⚠️ No cookies", file=sys.stderr)

    try:
        import yt_dlp
        import tempfile

        url = f"https://www.youtube.com/watch?v={video_id}"

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-orig', 'en-US'],
                'subtitlesformat': 'vtt',
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
                'socket_timeout': 30,
            }
            if cookies_path:
                ydl_opts['cookiefile'] = cookies_path
                print("✅ yt-dlp using cookies", file=sys.stderr)

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(url, download=True)

            sub_file = None
            for fname in os.listdir(tmpdir):
                if fname.endswith('.vtt'):
                    sub_file = os.path.join(tmpdir, fname)
                    break

            if not sub_file:
                print(json.dumps({"error": "No captions found for this video"}))
                return

            with open(sub_file, 'r', encoding='utf-8') as f:
                content = f.read()

            transcript_data = []
            seen_texts = set()
            for block in content.strip().split('\n\n'):
                lines = block.strip().split('\n')
                time_line = next((l for l in lines if '-->' in l), None)
                if not time_line:
                    continue
                try:
                    start_str = time_line.split('-->')[0].strip()
                    parts = start_str.replace(',', '.').split(':')
                    start = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2]) if len(parts)==3 else float(parts[0])*60 + float(parts[1])
                except:
                    continue
                text_lines = [re.sub(r'<[^>]+>', '', l).strip() for l in lines if '-->' not in l and l.strip()]
                text = ' '.join(text_lines).strip()
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    transcript_data.append({'text': text, 'start': start, 'duration': 0})

        if transcript_data:
            print(json.dumps(transcript_data))
        else:
            print(json.dumps({"error": "Could not parse captions"}))

    except Exception as e:
        print(json.dumps({"error": f"Failed: {str(e)}"}))

if __name__ == "__main__":
    get_transcript()