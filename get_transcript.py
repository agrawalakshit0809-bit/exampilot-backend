import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")

def setup_cookies():
    cookies_content = os.environ.get("YOUTUBE_COOKIES", "")
    if cookies_content:
        cookies_path = "/tmp/yt_cookies.txt"
        with open(cookies_path, "w") as f:
            f.write(cookies_content)
        return cookies_path
    return None

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]
    cookies_path = setup_cookies()

    # Method 1: youtube_transcript_api (fast)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        try:
            transcript = api.fetch(video_id, languages=['en','en-US','en-GB','en-IN'])
        except Exception:
            transcript_list = api.list(video_id)
            transcript = None
            for t in transcript_list:
                transcript = t.fetch()
                break
        if transcript:
            result = [{'text': s.text, 'start': s.start, 'duration': s.duration} for s in transcript]
            print(json.dumps(result))
            return
    except Exception:
        pass

    # Method 2: yt-dlp with vtt format (more compatible)
    try:
        import yt_dlp
        import tempfile
        import re

        url = f"https://www.youtube.com/watch?v={video_id}"

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-orig', 'en-US'],
                'subtitlesformat': 'vtt',          # ← changed from json3 to vtt
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
                'socket_timeout': 30,
            }
            if cookies_path:
                ydl_opts['cookiefile'] = cookies_path

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(url, download=True)

            # Find .vtt subtitle file
            sub_file = None
            for fname in os.listdir(tmpdir):
                if fname.endswith('.vtt'):
                    sub_file = os.path.join(tmpdir, fname)
                    break

            if not sub_file:
                print(json.dumps({"error": "No captions found for this video"}))
                return

            # Parse VTT file
            transcript_data = []
            with open(sub_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # Remove WEBVTT header and NOTE blocks
            content = re.sub(r'WEBVTT.*?\n\n', '', content, flags=re.DOTALL, count=1)
            content = re.sub(r'NOTE\n.*?\n\n', '', content, flags=re.DOTALL)

            # Parse timestamp blocks
            blocks = content.strip().split('\n\n')
            seen_texts = set()

            for block in blocks:
                lines = block.strip().split('\n')
                # Find timestamp line
                time_line = None
                for line in lines:
                    if '-->' in line:
                        time_line = line
                        break
                if not time_line:
                    continue

                # Parse start time
                try:
                    start_str = time_line.split('-->')[0].strip()
                    parts = start_str.replace(',', '.').split(':')
                    if len(parts) == 3:
                        start = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2])
                    else:
                        start = float(parts[0])*60 + float(parts[1])
                except:
                    continue

                # Get text lines (after timestamp)
                text_lines = []
                for line in lines:
                    if '-->' not in line and not line.startswith('WEBVTT') and line.strip():
                        # Remove VTT tags like <00:00:00.000><c>text</c>
                        clean = re.sub(r'<[^>]+>', '', line).strip()
                        if clean:
                            text_lines.append(clean)

                text = ' '.join(text_lines).strip()
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    transcript_data.append({
                        'text': text,
                        'start': start,
                        'duration': 0
                    })

            if transcript_data:
                print(json.dumps(transcript_data))
            else:
                print(json.dumps({"error": "Could not parse captions"}))

    except Exception as e:
        print(json.dumps({"error": f"No captions available: {str(e)}"}))

if __name__ == "__main__":
    get_transcript()