# omr-worker-server
## 5. README.md
```markdown
# OMR Worker Server

This worker server handles the heavy OMR processing using Audiveris and MuseScore CLI.

## Architecture

```
MelodiQ App → Supabase → Edge Function → Worker Server → Audiveris/MuseScore → Results
```

## Deployment Options

### Option 1: Railway (Recommended)
1. Create a new Railway project
2. Connect this repository
3. Set environment variables:
   - `OMR_WORKER_API_KEY=your-secure-api-key`
   - `SUPABASE_URL=your-supabase-url`
   - `SUPABASE_SERVICE_KEY=your-service-key`

### Option 2: Render
1. Create a new Web Service
2. Connect repository
3. Set build command: `npm install`
4. Set start command: `npm start`

### Option 3: Your own VPS
1. Install Node.js, Audiveris, and MuseScore
2. Clone this repository
3. Run `npm install && npm start`

## API Endpoints

### POST /api/process-score
Processes a music score through the OMR pipeline.

**Request:**
```json
{
  "scoreId": "uuid",
  "fileData": "base64-encoded-file",
  "fileType": "pdf|png|jpg",
  "fileName": "score.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "musicXmlContent": "<?xml version='1.0'?>...",
  "metadata": {
    "instrument": "Piano",
    "clef": "Treble",
    "keySignature": "C Major",
    "timeSignature": "4/4",
    "tempo": 120,
    "measureCount": 32,
    "style": "Classical"
  },
  "measurePairs": [
    {
      "pairNumber": 1,
      "startMeasure": 1,
      "endMeasure": 2,
      "imageData": "base64-png-data"
    }
  ]
}
```

## Required Software

The worker server needs these installed:

1. **Audiveris** - For PDF/image to MusicXML conversion
   - Download from: https://github.com/Audiveris/audiveris
   - Install Java 11+ as prerequisite

2. **MuseScore CLI** - For metadata extraction and image generation
   - Download from: https://musescore.org/
   - Use headless mode for server deployment

3. **ImageMagick** - For image processing
   - Install via package manager

## Security

- Use API key authentication
- Validate all file inputs
- Sandbox the CLI processes
- Clean up temporary files
- Rate limit requests

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Test with sample score
curl -X POST http://localhost:3001/api/process-score \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer development-key" \
  -d '{"scoreId":"test","fileData":"...","fileType":"pdf"}'
```

## Production Notes

- Use process managers (PM2, systemd)
- Set up log rotation
- Monitor disk space (temporary files)
- Configure automatic restarts
- Set up health checks
```
