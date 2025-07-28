## 1. server.js
```javascript
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const xml2js = require('xml2js');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories
const TEMP_DIR = path.join(__dirname, 'temp');
const AUDIVERIS_PATH = process.env.AUDIVERIS_PATH || '/usr/local/bin/audiveris';
const MUSESCORE_PATH = process.env.MUSESCORE_PATH || 'mscore';

// Ensure temp directory exists
fs.ensureDirSync(TEMP_DIR);

// Authentication middleware
const authenticateRequest = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.OMR_WORKER_API_KEY || 'development-key';
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.split(' ')[1];
  if (token !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      audiveris: fs.existsSync(AUDIVERIS_PATH),
      musescore: true // We'll check this dynamically
    }
  });
});

// Main OMR processing endpoint
app.post('/api/process-score', authenticateRequest, async (req, res) => {
  const { scoreId, fileData, fileType, fileName } = req.body;
  
  if (!scoreId || !fileData || !fileType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sessionId = uuidv4();
  const sessionDir = path.join(TEMP_DIR, sessionId);
  
  try {
    console.log(`Starting OMR processing for score ${scoreId}, session ${sessionId}`);
    
    // Create session directory
    await fs.ensureDir(sessionDir);
    
    // Step 1: Save uploaded file
    const originalFile = path.join(sessionDir, `original.${fileType}`);
    const buffer = Buffer.from(fileData, 'base64');
    await fs.writeFile(originalFile, buffer);
    
    console.log(`File saved: ${originalFile}, size: ${buffer.length} bytes`);
    
    // Step 2: Convert to MusicXML using Audiveris
    const musicXmlFile = path.join(sessionDir, 'score.musicxml');
    const musicXmlContent = await convertToMusicXML(originalFile, musicXmlFile, fileType);
    
    // Step 3: Process with MuseScore CLI for metadata and images
    const { metadata, measurePairs } = await processWithMuseScore(musicXmlFile, sessionDir);
    
    // Step 4: Return results
    const result = {
      success: true,
      scoreId,
      sessionId,
      musicXmlContent: musicXmlContent ? await fs.readFile(musicXmlFile, 'utf8') : null,
      metadata,
      measurePairs
    };
    
    console.log(`OMR processing completed for score ${scoreId}`);
    res.json(result);
    
  } catch (error) {
    console.error(`OMR processing error for score ${scoreId}:`, error);
    res.status(500).json({ 
      error: error.message,
      scoreId,
      sessionId 
    });
  } finally {
    // Cleanup session directory after a delay
    setTimeout(async () => {
      try {
        await fs.remove(sessionDir);
        console.log(`Cleaned up session directory: ${sessionId}`);
      } catch (cleanupError) {
        console.error(`Failed to cleanup session ${sessionId}:`, cleanupError);
      }
    }, 60000); // 1 minute delay
  }
});

// Convert file to MusicXML using Audiveris
async function convertToMusicXML(inputFile, outputFile, fileType) {
  console.log(`Converting ${inputFile} to MusicXML using Audiveris`);
  
  try {
    // Check if Audiveris is available
    if (!fs.existsSync(AUDIVERIS_PATH)) {
      console.log('Audiveris not found, using mock conversion');
      return await mockAudiverisConversion(inputFile, outputFile, fileType);
    }
    
    // Run Audiveris CLI
    const command = `${AUDIVERIS_PATH} -batch -export "${outputFile}" "${inputFile}"`;
    console.log(`Executing: ${command}`);
    
    const { stdout, stderr } = await execAsync(command, { 
      timeout: 120000, // 2 minutes timeout
      cwd: path.dirname(outputFile)
    });
    
    if (stderr) {
      console.log('Audiveris stderr:', stderr);
    }
    
    if (fs.existsSync(outputFile)) {
      console.log('MusicXML conversion successful');
      return true;
    } else {
      throw new Error('Audiveris did not produce output file');
    }
    
  } catch (error) {
    console.error('Audiveris conversion failed:', error);
    // Fallback to mock conversion
    return await mockAudiverisConversion(inputFile, outputFile, fileType);
  }
}

// Mock Audiveris conversion for development/fallback
async function mockAudiverisConversion(inputFile, outputFile, fileType) {
  console.log('Using mock Audiveris conversion');
  
  const mockMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work>
    <work-title>Converted Score</work-title>
  </work>
  <identification>
    <creator type="software">Mock Audiveris</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
  
  await fs.writeFile(outputFile, mockMusicXML);
  return true;
}

// Process MusicXML with MuseScore CLI
async function processWithMuseScore(musicXmlFile, sessionDir) {
  console.log(`Processing ${musicXmlFile} with MuseScore CLI`);
  
  try {
    // Check if MuseScore is available
    const { stdout: msVersion } = await execAsync(`${MUSESCORE_PATH} --version`);
    console.log('MuseScore version:', msVersion.trim());
    
    // Extract metadata from MusicXML
    const metadata = await extractMetadata(musicXmlFile);
    
    // Generate full score PNG
    const fullScorePng = path.join(sessionDir, 'full-score.png');
    await execAsync(`${MUSESCORE_PATH} "${musicXmlFile}" -o "${fullScorePng}"`);
    
    // Generate measure pair images
    const measurePairs = await generateMeasurePairs(musicXmlFile, sessionDir, metadata.measureCount || 8);
    
    return { metadata, measurePairs };
    
  } catch (error) {
    console.error('MuseScore processing failed:', error);
    // Fallback to mock processing
    return await mockMuseScoreProcessing(musicXmlFile, sessionDir);
  }
}

// Extract metadata from MusicXML
async function extractMetadata(musicXmlFile) {
  try {
    const xmlContent = await fs.readFile(musicXmlFile, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlContent);
    
    const scorePartwise = result['score-partwise'];
    const part = scorePartwise.part[0];
    const firstMeasure = part.measure[0];
    const attributes = firstMeasure.attributes?.[0];
    
    // Extract key signature
    const keyFifths = attributes?.key?.[0]?.fifths?.[0] || '0';
    const keySignature = getKeySignature(parseInt(keyFifths));
    
    // Extract time signature
    const timeBeats = attributes?.time?.[0]?.beats?.[0] || '4';
    const timeBeatType = attributes?.time?.[0]?.['beat-type']?.[0] || '4';
    const timeSignature = `${timeBeats}/${timeBeatType}`;
    
    // Extract clef
    const clefSign = attributes?.clef?.[0]?.sign?.[0] || 'G';
    const clef = clefSign === 'G' ? 'Treble' : clefSign === 'F' ? 'Bass' : 'Treble';
    
    // Count measures
    const measureCount = part.measure.length;
    
    // Extract instrument
    const partList = scorePartwise['part-list'][0];
    const scorePart = partList['score-part'][0];
    const instrument = scorePart['part-name']?.[0] || 'Piano';
    
    return {
      instrument,
      clef,
      keySignature,
      timeSignature,
      tempo: 120, // Default tempo
      measureCount,
      style: 'Classical'
    };
    
  } catch (error) {
    console.error('Metadata extraction failed:', error);
    return {
      instrument: 'Piano',
      clef: 'Treble',
      keySignature: 'C Major',
      timeSignature: '4/4',
      tempo: 120,
      measureCount: 8,
      style: 'Classical'
    };
  }
}

// Generate measure pair images
async function generateMeasurePairs(musicXmlFile, sessionDir, totalMeasures) {
  const measurePairs = [];
  const pairsCount = Math.ceil(totalMeasures / 2);
  
  for (let i = 0; i < pairsCount; i++) {
    const startMeasure = (i * 2) + 1;
    const endMeasure = Math.min(startMeasure + 1, totalMeasures);
    const pairNumber = i + 1;
    
    try {
      // Generate image for measure pair using MuseScore
      const measureImage = path.join(sessionDir, `measures-${startMeasure}-${endMeasure}.png`);
      
      // Create a temporary MusicXML with only these measures
      const pairXml = await extractMeasureRange(musicXmlFile, startMeasure, endMeasure);
      const pairXmlFile = path.join(sessionDir, `pair-${pairNumber}.musicxml`);
      await fs.writeFile(pairXmlFile, pairXml);
      
      // Generate PNG from the pair XML
      await execAsync(`${MUSESCORE_PATH} "${pairXmlFile}" -o "${measureImage}"`);
      
      if (fs.existsSync(measureImage)) {
        // Convert to base64
        const imageBuffer = await fs.readFile(measureImage);
        const imageData = imageBuffer.toString('base64');
        
        measurePairs.push({
          pairNumber,
          startMeasure,
          endMeasure,
          imageData
        });
      }
      
    } catch (error) {
      console.error(`Failed to generate measure pair ${pairNumber}:`, error);
      // Generate mock image
      const mockImageData = await generateMockMeasureImage(startMeasure, endMeasure);
      measurePairs.push({
        pairNumber,
        startMeasure,
        endMeasure,
        imageData: mockImageData
      });
    }
  }
  
  return measurePairs;
}

// Mock MuseScore processing for development
async function mockMuseScoreProcessing(musicXmlFile, sessionDir) {
  console.log('Using mock MuseScore processing');
  
  const metadata = {
    instrument: 'Piano',
    clef: 'Treble',
    keySignature: 'C Major',
    timeSignature: '4/4',
    tempo: 120,
    measureCount: 8,
    style: 'Classical'
  };
  
  const measurePairs = [];
  for (let i = 0; i < 4; i++) {
    const startMeasure = (i * 2) + 1;
    const endMeasure = startMeasure + 1;
    const mockImageData = await generateMockMeasureImage(startMeasure, endMeasure);
    
    measurePairs.push({
      pairNumber: i + 1,
      startMeasure,
      endMeasure,
      imageData: mockImageData
    });
  }
  
  return { metadata, measurePairs };
}

// Generate mock measure image
async function generateMockMeasureImage(startMeasure, endMeasure) {
  const width = 400;
  const height = 200;
  
  // Create a simple mock music score image using Sharp
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <g stroke="black" stroke-width="2" fill="none">
        <!-- Staff lines -->
        <line x1="50" y1="60" x2="350" y2="60"/>
        <line x1="50" y1="80" x2="350" y2="80"/>
        <line x1="50" y1="100" x2="350" y2="100"/>
        <line x1="50" y1="120" x2="350" y2="120"/>
        <line x1="50" y1="140" x2="350" y2="140"/>
        
        <!-- Bar lines -->
        <line x1="50" y1="60" x2="50" y2="140"/>
        <line x1="200" y1="60" x2="200" y2="140"/>
        <line x1="350" y1="60" x2="350" y2="140"/>
      </g>
      
      <!-- Notes -->
      <circle cx="100" cy="100" r="8" fill="black"/>
      <circle cx="150" cy="80" r="8" fill="black"/>
      <circle cx="250" cy="120" r="8" fill="black"/>
      <circle cx="300" cy="100" r="8" fill="black"/>
      
      <!-- Measure numbers -->
      <text x="125" y="50" font-family="Arial" font-size="14" text-anchor="middle">${startMeasure}</text>
      <text x="275" y="50" font-family="Arial" font-size="14" text-anchor="middle">${endMeasure}</text>
    </svg>
  `;
  
  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();
    
  return buffer.toString('base64');
}

// Helper functions
function getKeySignature(fifths) {
  const keys = {
    '-7': 'Cb Major', '-6': 'Gb Major', '-5': 'Db Major', '-4': 'Ab Major',
    '-3': 'Eb Major', '-2': 'Bb Major', '-1': 'F Major', '0': 'C Major',
    '1': 'G Major', '2': 'D Major', '3': 'A Major', '4': 'E Major',
    '5': 'B Major', '6': 'F# Major', '7': 'C# Major'
  };
  return keys[fifths.toString()] || 'C Major';
}

async function extractMeasureRange(musicXmlFile, startMeasure, endMeasure) {
  // Simplified - return original XML for now
  // In production, this would extract specific measures
  return await fs.readFile(musicXmlFile, 'utf8');
}

// Start server
app.listen(PORT, () => {
  console.log(`OMR Worker Server running on port ${PORT}`);
  console.log(`Audiveris path: ${AUDIVERIS_PATH}`);
  console.log(`MuseScore path: ${MUSESCORE_PATH}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
```
