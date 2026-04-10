import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]
    url = f"https://www.youtube.com/watch?v={video_id}"

    # Method 1: youtube_transcript_api (try first)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        
        # Prefer manual English, then auto English
        try:
            transcript = transcript_list.find_transcript(['en'])
        except:
            try:
                transcript = transcript_list.find_generated_transcript(['en'])
            except:
                transcript = transcript_list.find_transcript(transcript_list.find_transcript().language_code)

        data = transcript.fetch()
        result = [{'text': s['text'], 'start': s['start'], 'duration': s['duration']} for s in data]
        print(json.dumps(result))
        return
    except Exception as e:
        pass  # Fall to yt-dlp

    # Method 2: Improved yt-dlp fallback
    try:
        import yt_dlp
        cookies_path = None
        cookies_content = os.environ.get("YOUTUBE_COOKIES", "")
        if cookies_content:
            cookies_path = "/tmp/yt_cookies.txt"
        with open(cookies_path, "w") as f:
            f.write(cookies_content)
        ydl_opts = {
            'skip_download': True,
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['en', 'en-US', 'en-GB', 'en-orig'],
            'subtitlesformat': 'vtt',           # More reliable than json3
            'quiet': True,
            'no_warnings': True,
            'extractor_args': {'youtube': {'player_client': ['web', 'android', 'ios']}},
        }
        if cookies_path:
            ydl_opts['cookiefile'] = cookies_path
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        # Check for subtitles in info
        subtitles = info.get('subtitles') or info.get('automatic_captions') or {}
        
        if subtitles:
            # Try to get English VTT
            for lang in ['en', 'en-US', 'en-GB']:
                if lang in subtitles:
                    # For simplicity, we'll re-download the subtitle using yt-dlp command style
                    pass

        # Fallback: run yt-dlp with --write-auto-sub and parse VTT (more reliable)
        import tempfile
        import re

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts_download = {
                'skip_download': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en'],
                'outtmpl': os.path.join(tmpdir, 'sub'),
                'quiet': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts_download) as ydl:
                ydl.download([url])

            # Find any .vtt or .en.vtt file
            for file in os.listdir(tmpdir):
                if file.endswith('.vtt'):
                    with open(os.path.join(tmpdir, file), 'r', encoding='utf-8') as f:
                        vtt = f.read()

                    # Simple VTT parser
                    transcript_data = []
                    lines = vtt.splitlines()
                    i = 0
                    while i < len(lines):
                        if '-->' in lines[i]:
                            # Next lines are text
                            text = []
                            i += 1
                            while i < len(lines) and lines[i].strip() and not '-->' in lines[i]:
                                text.append(lines[i].strip())
                                i += 1
                            full_text = ' '.join(text).strip()
                            if full_text:
                                transcript_data.append({'text': full_text, 'start': 0, 'duration': 0})
                        else:
                            i += 1

                    if transcript_data:
                        print(json.dumps(transcript_data))
                        return

        print(json.dumps({"error": "No captions found for this video"}))
        return

    except Exception as e:
        print(json.dumps({"error": f"Failed to get transcript: {str(e)}"}))

if __name__ == "__main__":
    get_transcript()