// Run with: node scripts/generate-icons.js
// Requires: npm install canvas (optional - for better quality)

const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, '..', 'public', 'icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Read the SVG
const svgPath = path.join(iconsDir, 'icon.svg');
const svgContent = fs.readFileSync(svgPath, 'utf8');

console.log('SVG icon is ready at:', svgPath);
console.log('\nTo generate PNG icons, you have several options:\n');
console.log('Option 1: Use the generate-icons.html file');
console.log('  1. Run: npm run dev');
console.log('  2. Open: http://localhost:3000/generate-icons.html');
console.log('  3. Download each icon size\n');
console.log('Option 2: Use an online converter');
console.log('  1. Go to: https://cloudconvert.com/svg-to-png');
console.log('  2. Upload public/icons/icon.svg');
console.log('  3. Generate for sizes: 72, 96, 128, 144, 152, 192, 384, 512');
console.log('  4. Save as icon-{size}x{size}.png\n');
console.log('Option 3: Use ImageMagick (if installed)');
sizes.forEach(size => {
  console.log(`  magick convert -background none -resize ${size}x${size} "${svgPath}" "${path.join(iconsDir, `icon-${size}x${size}.png`)}"`);
});

console.log('\nFor now, creating placeholder text files to prevent build errors...');

// Create placeholder files
sizes.forEach(size => {
  const placeholderPath = path.join(iconsDir, `icon-${size}x${size}.png.txt`);
  fs.writeFileSync(placeholderPath, `Placeholder for ${size}x${size} PNG icon. Generate from icon.svg`);
});

console.log('Done! Remember to replace .png.txt files with actual .png files.');
