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

    # Try Method 1: youtube_transcript_api (fast)
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
        pass  # Fall through to yt-dlp

    # Try Method 2: yt-dlp (bypasses IP blocks)
    try:
        import yt_dlp
        import tempfile

        url = f"https://www.youtube.com/watch?v={video_id}"
        transcript_data = []

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-orig'],
                'subtitlesformat': 'json3',
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
                'extractor_args': {
                    'youtube': {
                        'player_client': ['web', 'android']
                    }
                }
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            # Find subtitle file
            sub_file = None
            for fname in os.listdir(tmpdir):
                if fname.endswith('.json3'):
                    sub_file = os.path.join(tmpdir, fname)
                    break

            if sub_file:
                with open(sub_file, 'r', encoding='utf-8') as f:
                    sub_data = json.load(f)

                for event in sub_data.get('events', []):
                    if 'segs' not in event:
                        continue
                    text = ''.join(s.get('utf8', '') for s in event['segs']).strip()
                    if text and text != '\n':
                        start = event.get('tStartMs', 0) / 1000
                        duration = event.get('dDurationMs', 0) / 1000
                        transcript_data.append({
                            'text': text,
                            'start': start,
                            'duration': duration
                        })

        if transcript_data:
            print(json.dumps(transcript_data))
            return
        else:
            print(json.dumps({"error": "No captions found for this video"}))

    except Exception as e:
        print(json.dumps({"error": f"No captions available: {str(e)}"}))

if __name__ == "__main__":
    get_transcript()