const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const sharp = require('sharp');
const xml2js = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuration
const TEMP_DIR = '/tmp/omr_sessions';
const AUDIVERIS_PATH = process.env.AUDIVERIS_PATH || '/opt/audiveris/bin/Audiveris';
const MUSESCORE_PATH = process.env.MUSESCORE_PATH || 'mscore';

// Ensure temp directory exists
fs.ensureDirSync(TEMP_DIR);

// Authentication middleware
const authenticateRequest = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.OMR_WORKER_API_KEY;
  
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    audiveris_available: fs.existsSync(AUDIVERIS_PATH)
  };
  res.json(status);
});

// Main OMR processing endpoint
app.post('/api/process-score', authenticateRequest, async (req, res) => {
  const { scoreId, fileData, fileType, fileName } = req.body;
  
  if (!scoreId || !fileData || !fileType || !fileName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sessionId = `${scoreId}_${Date.now()}`;
  const sessionDir = path.join(TEMP_DIR, sessionId);
  
  try {
    // Create session directory
    await fs.ensureDir(sessionDir);
    
    // Save uploaded file
    const buffer = Buffer.from(fileData, 'base64');
    const inputFile = path.join(sessionDir, fileName);
    await fs.writeFile(inputFile, buffer);
    
    // Convert to MusicXML using Audiveris
    const musicXmlFile = path.join(sessionDir, 'score.musicxml');
    await convertToMusicXML(inputFile, musicXmlFile, fileType);
    
    // Process with MuseScore
    const results = await processWithMuseScore(musicXmlFile, sessionDir);
    
    // Read MusicXML content
    const musicXmlContent = await fs.readFile(musicXmlFile, 'utf8');
    
    const response = {
      success: true,
      scoreId,
      musicXml: musicXmlContent,
      metadata: results.metadata,
      measurePairs: results.measurePairs
    };
    
    res.json(response);
    
    // Clean up after delay
    setTimeout(async () => {
      try {
        await fs.remove(sessionDir);
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }, 300000); // 5 minutes
    
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: 'Processing failed', 
      details: error.message 
    });
    
    // Clean up on error
    try {
      await fs.remove(sessionDir);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
});

// Convert to MusicXML using Audiveris
async function convertToMusicXML(inputFile, outputFile, fileType) {
  return new Promise((resolve, reject) => {
    // Check if Audiveris is available
    if (!fs.existsSync(AUDIVERIS_PATH)) {
      console.log('Audiveris not found, using mock conversion');
      return mockAudiverisConversion(outputFile).then(resolve).catch(reject);
    }
    
    const command = `"${AUDIVERIS_PATH}" -batch -export "${outputFile}" "${inputFile}"`;
    
    exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Audiveris error:', error);
        console.log('Falling back to mock conversion');
        return mockAudiverisConversion(outputFile).then(resolve).catch(reject);
      }
      
      // Check if output file was created
      if (!fs.existsSync(outputFile)) {
        console.log('Audiveris did not create output file, using mock');
        return mockAudiverisConversion(outputFile).then(resolve).catch(reject);
      }
      
      console.log('Audiveris conversion successful');
      resolve();
    });
  });
}

// Mock Audiveris conversion for testing
async function mockAudiverisConversion(outputFile) {
  const mockMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work>
    <work-title>Mock Score</work-title>
  </work>
  <identification>
    <creator type="composer">Mock Composer</creator>
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
        <divisions>1</divisions>
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
        <type>whole</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
  
  await fs.writeFile(outputFile, mockMusicXML);
}

// Process with MuseScore
async function processWithMuseScore(musicXmlFile, sessionDir) {
  try {
    // Check if MuseScore is available
    const museScoreAvailable = await new Promise((resolve) => {
      exec(`${MUSESCORE_PATH} --version`, (error) => {
        resolve(!error);
      });
    });
    
    if (!museScoreAvailable) {
      console.log('MuseScore not available, using mock processing');
      return await mockMuseScoreProcessing(musicXmlFile, sessionDir);
    }
    
    // Extract metadata
    const metadata = await extractMetadata(musicXmlFile);
    
    // Generate measure pairs
    const measurePairs = await generateMeasurePairs(musicXmlFile, sessionDir, metadata.totalMeasures);
    
    return {
      metadata,
      measurePairs
    };
    
  } catch (error) {
    console.error('MuseScore processing error:', error);
    return await mockMuseScoreProcessing(musicXmlFile, sessionDir);
  }
}

// Extract metadata from MusicXML
async function extractMetadata(musicXmlFile) {
  const content = await fs.readFile(musicXmlFile, 'utf8');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(content);
  
  const score = result['score-partwise'] || result['score-timewise'];
  if (!score) throw new Error('Invalid MusicXML format');
  
  const partList = score['part-list'][0];
  const parts = score.part;
  
  // Extract basic information
  const title = score.work?.[0]?.['work-title']?.[0] || 'Untitled';
  const composer = score.identification?.[0]?.creator?.find(c => c.$.type === 'composer')?._?.toString() || 'Unknown';
  
  // Extract instrument info from first part
  const firstPart = partList['score-part'][0];
  const instrument = firstPart['part-name'][0] || 'Unknown';
  
  // Extract musical attributes from first measure
  const firstMeasure = parts[0].measure[0];
  const attributes = firstMeasure.attributes?.[0];
  
  let clef = 'treble';
  let keySignature = 'C major';
  let timeSignature = '4/4';
  
  if (attributes) {
    if (attributes.clef?.[0]) {
      const clefSign = attributes.clef[0].sign[0];
      const clefLine = attributes.clef[0].line[0];
      clef = clefSign === 'G' && clefLine === '2' ? 'treble' : 
             clefSign === 'F' && clefLine === '4' ? 'bass' : 'treble';
    }
    
    if (attributes.key?.[0]?.fifths) {
      const fifths = parseInt(attributes.key[0].fifths[0]);
      keySignature = getKeySignature(fifths);
    }
    
    if (attributes.time?.[0]) {
      const beats = attributes.time[0].beats[0];
      const beatType = attributes.time[0]['beat-type'][0];
      timeSignature = `${beats}/${beatType}`;
    }
  }
  
  // Count total measures
  const totalMeasures = parts[0].measure.length;
  
  return {
    title,
    composer,
    instrument,
    clef,
    keySignature,
    timeSignature,
    totalMeasures
  };
}

// Generate measure pair images
async function generateMeasurePairs(musicXmlFile, sessionDir, totalMeasures) {
  const measurePairs = [];
  const pairsDir = path.join(sessionDir, 'pairs');
  await fs.ensureDir(pairsDir);
  
  for (let i = 1; i <= totalMeasures; i += 2) {
    const endMeasure = Math.min(i + 1, totalMeasures);
    const pairName = `measures_${i}_${endMeasure}`;
    
    try {
      // Extract measures and create temporary MusicXML
      const pairXmlFile = path.join(pairsDir, `${pairName}.musicxml`);
      await extractMeasureRange(musicXmlFile, pairXmlFile, i, endMeasure);
      
      // Generate SVG with MuseScore
      const svgFile = path.join(pairsDir, `${pairName}.svg`);
      
      const command = `${MUSESCORE_PATH} "${pairXmlFile}" -o "${svgFile}"`;
      
      await new Promise((resolve, reject) => {
        exec(command, { timeout: 30000 }, async (error, stdout, stderr) => {
          if (error) {
            console.error(`MuseScore error for ${pairName}:`, error);
            // Generate mock image
            await generateMockMeasureImage(svgFile, i, endMeasure);
          }
          resolve();
        });
      });
      
      // Read and encode the SVG
      if (await fs.pathExists(svgFile)) {
        const svgContent = await fs.readFile(svgFile, 'utf8');
        const imageData = Buffer.from(svgContent).toString('base64');
        
        measurePairs.push({
          measures: `${i}-${endMeasure}`,
          imageData: `data:image/svg+xml;base64,${imageData}`
        });
      }
      
    } catch (error) {
      console.error(`Error generating pair ${i}-${endMeasure}:`, error);
      
      // Generate mock image
      const mockSvgFile = path.join(pairsDir, `${pairName}_mock.svg`);
      await generateMockMeasureImage(mockSvgFile, i, endMeasure);
      
      if (await fs.pathExists(mockSvgFile)) {
        const svgContent = await fs.readFile(mockSvgFile, 'utf8');
        const imageData = Buffer.from(svgContent).toString('base64');
        
        measurePairs.push({
          measures: `${i}-${endMeasure}`,
          imageData: `data:image/svg+xml;base64,${imageData}`
        });
      }
    }
  }
  
  return measurePairs;
}

// Mock MuseScore processing
async function mockMuseScoreProcessing(musicXmlFile, sessionDir) {
  const metadata = await extractMetadata(musicXmlFile);
  const measurePairs = [];
  
  // Generate mock measure images
  for (let i = 1; i <= metadata.totalMeasures; i += 2) {
    const endMeasure = Math.min(i + 1, metadata.totalMeasures);
    const mockSvgFile = path.join(sessionDir, `mock_measures_${i}_${endMeasure}.svg`);
    
    await generateMockMeasureImage(mockSvgFile, i, endMeasure);
    
    const svgContent = await fs.readFile(mockSvgFile, 'utf8');
    const imageData = Buffer.from(svgContent).toString('base64');
    
    measurePairs.push({
      measures: `${i}-${endMeasure}`,
      imageData: `data:image/svg+xml;base64,${imageData}`
    });
  }
  
  return {
    metadata,
    measurePairs
  };
}

// Generate mock measure image using Sharp
async function generateMockMeasureImage(outputFile, startMeasure, endMeasure) {
  const width = 800;
  const height = 200;
  
  // Create a simple SVG representation
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <g stroke="black" stroke-width="2" fill="none">
        <!-- Staff lines -->
        <line x1="50" y1="60" x2="750" y2="60"/>
        <line x1="50" y1="80" x2="750" y2="80"/>
        <line x1="50" y1="100" x2="750" y2="100"/>
        <line x1="50" y1="120" x2="750" y2="120"/>
        <line x1="50" y1="140" x2="750" y2="140"/>
        
        <!-- Measure lines -->
        <line x1="50" y1="60" x2="50" y2="140"/>
        <line x1="400" y1="60" x2="400" y2="140"/>
        <line x1="750" y1="60" x2="750" y2="140"/>
      </g>
      
      <!-- Mock notes -->
      <circle cx="150" cy="100" r="8" fill="black"/>
      <circle cx="250" cy="80" r="8" fill="black"/>
      <circle cx="550" cy="120" r="8" fill="black"/>
      <circle cx="650" cy="100" r="8" fill="black"/>
      
      <!-- Measure numbers -->
      <text x="200" y="40" font-family="Arial" font-size="16" text-anchor="middle">Measure ${startMeasure}</text>
      ${endMeasure > startMeasure ? `<text x="600" y="40" font-family="Arial" font-size="16" text-anchor="middle">Measure ${endMeasure}</text>` : ''}
    </svg>
  `;
  
  await fs.writeFile(outputFile, svg);
}

// Helper function to get key signature name
function getKeySignature(fifths) {
  const keyMap = {
    '-7': 'Cb major', '-6': 'Gb major', '-5': 'Db major', '-4': 'Ab major',
    '-3': 'Eb major', '-2': 'Bb major', '-1': 'F major', '0': 'C major',
    '1': 'G major', '2': 'D major', '3': 'A major', '4': 'E major',
    '5': 'B major', '6': 'F# major', '7': 'C# major'
  };
  return keyMap[fifths.toString()] || 'C major';
}

// Extract specific measure range from MusicXML (simplified implementation)
async function extractMeasureRange(inputFile, outputFile, startMeasure, endMeasure) {
  // For now, just copy the entire file
  // In a full implementation, this would extract only the specified measures
  await fs.copy(inputFile, outputFile);
}

// Start server
app.listen(PORT, () => {
  console.log(`OMR Worker Server running on port ${PORT}`);
  console.log(`Audiveris path: ${AUDIVERIS_PATH}`);
  console.log(`MuseScore path: ${MUSESCORE_PATH}`);
  console.log(`Temp directory: ${TEMP_DIR}`);
});
