import settings from '../settings.js';
import prismarineViewer from 'prismarine-viewer';
const mineflayerViewer = prismarineViewer.mineflayer;

let viewerActive = false;

export function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view && !viewerActive) {
        // Use count_id to prevent EADDRINUSE on port 3000
        const port = 3000 + (count_id || 0);
        try {
            mineflayerViewer(bot, { port: port, firstPerson: settings.first_person_view });
            viewerActive = true;
            console.log(`Prismarine viewer started on port ${port}`);
        } catch (err) {
            console.error("Viewer failed to start:", err.message);
        }
    }
}