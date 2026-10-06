const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

const { execFile } = require('child_process');
const server = http.createServer((req, res) => {
    // CORS headers para permitir llamadas desde localhost o file://
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    };

    if (req.method === 'OPTIONS' && (req.url === '/api/clipboard' || req.url.startsWith('/api/'))) {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    // API Portapapeles Nativo Windows (RTF + HTML + PlainText para SAE / Word / Excel)
    if (req.method === 'POST' && req.url === '/api/clipboard') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const pyScript = path.join(__dirname, 'set_clipboard.py');
                const child = execFile('python', [pyScript], (err, stdout, stderr) => {
                    if (err) {
                        res.writeHead(500, corsHeaders);
                        res.end(JSON.stringify({ success: false, error: err.message, stderr }));
                        return;
                    }
                    res.writeHead(200, corsHeaders);
                    res.end(stdout || JSON.stringify({ success: true }));
                });
                child.stdin.write(body);
                child.stdin.end();
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // GET Configuración Aranceles
    if (req.method === 'GET' && req.url === '/api/config-aranceles') {
        const configPath = path.join(__dirname, 'config_aranceles.json');
        const tokenPath = path.join(__dirname, 'token_github.local');
        fs.readFile(configPath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: err.message }));
                return;
            }
            try {
                const parsed = JSON.parse(data);
                if (fs.existsSync(tokenPath)) {
                    const savedToken = fs.readFileSync(tokenPath, 'utf8').trim();
                    if (!parsed.github) parsed.github = {};
                    parsed.github.token = savedToken;
                }
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(parsed, null, 2));
            } catch(e) {
                res.writeHead(200, corsHeaders);
                res.end(data);
            }
        });
        return;
    }

    // POST Guardar Configuración Aranceles (Local + Git Commit + GitHub API sync)
    if (req.method === 'POST' && req.url === '/api/config-aranceles') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const newConfig = JSON.parse(body);
                newConfig.ultimaActualizacion = new Date().toISOString();
                const configPath = path.join(__dirname, 'config_aranceles.json');
                const tokenPath = path.join(__dirname, 'token_github.local');

                // Si viene token, guardarlo localmente en archivo ignorado por git
                let activeToken = '';
                if (newConfig.github && newConfig.github.token && newConfig.github.token.trim()) {
                    activeToken = newConfig.github.token.trim();
                    fs.writeFileSync(tokenPath, activeToken, 'utf8');
                } else if (fs.existsSync(tokenPath)) {
                    activeToken = fs.readFileSync(tokenPath, 'utf8').trim();
                }

                // Sanitizar token para no exponerlo en el repositorio público
                const configToSave = JSON.parse(JSON.stringify(newConfig));
                if (configToSave.github) {
                    configToSave.github.token = '';
                }

                const configStr = JSON.stringify(configToSave, null, 2);
                fs.writeFile(configPath, configStr, 'utf8', (writeErr) => {
                    if (writeErr) {
                        res.writeHead(500, corsHeaders);
                        res.end(JSON.stringify({ success: false, error: writeErr.message }));
                        return;
                    }

                    // Sincronización inteligente:
                    // Si hay token activo, usamos la API REST de GitHub (crea el commit en GitHub) y luego sincronizamos localmente con git pull --rebase.
                    // Si NO hay token, usamos Git CLI local (git commit + push origin main).
                    let githubSync = false;
                    const repoTarget = (newConfig.github && newConfig.github.repo) ? newConfig.github.repo : '';

                    if (activeToken && repoTarget) {
                        try {
                            const [owner, repo] = repoTarget.split('/');
                            const filePath = (newConfig.github && newConfig.github.path) ? newConfig.github.path : 'config_aranceles.json';
                            const branch = (newConfig.github && newConfig.github.branch) ? newConfig.github.branch : 'main';
                            
                            const https = require('https');
                            const ghHeaders = {
                                'User-Agent': 'JudicialPro-ConfigSync',
                                'Authorization': `token ${activeToken}`,
                                'Accept': 'application/vnd.github.v3+json'
                            };

                            const getReq = https.request({
                                hostname: 'api.github.com',
                                path: `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
                                method: 'GET',
                                headers: ghHeaders
                            }, (ghRes) => {
                                let ghBody = '';
                                ghRes.on('data', c => ghBody += c);
                                ghRes.on('end', () => {
                                    let sha = null;
                                    try {
                                        const parsed = JSON.parse(ghBody);
                                        if (parsed && parsed.sha) sha = parsed.sha;
                                    } catch(e) {}

                                    const putPayload = JSON.stringify({
                                        message: `Actualización de aranceles desde Judicial Pro web`,
                                        content: Buffer.from(configStr).toString('base64'),
                                        sha: sha || undefined,
                                        branch: branch
                                    });

                                    const putReq = https.request({
                                        hostname: 'api.github.com',
                                        path: `/repos/${owner}/${repo}/contents/${filePath}`,
                                        method: 'PUT',
                                        headers: {
                                            ...ghHeaders,
                                            'Content-Type': 'application/json',
                                            'Content-Length': Buffer.byteLength(putPayload)
                                        }
                                    }, () => {
                                        // Luego del commit en GitHub, sincronizar el repositorio local
                                        execFile('git', ['pull', '--rebase', 'origin', branch], () => {});
                                    });
                                    putReq.write(putPayload);
                                    putReq.end();
                                });
                            });
                            getReq.on('error', (e) => console.warn('GitHub get file err:', e.message));
                            getReq.end();
                            githubSync = true;
                        } catch (ghErr) {
                            console.warn('GitHub direct sync warning:', ghErr.message);
                        }
                    } else {
                        // Modo Git CLI local (sin token)
                        execFile('git', ['add', 'config_aranceles.json'], () => {
                            execFile('git', ['commit', '-m', `Actualizar aranceles de planilla fiscal [${new Date().toLocaleDateString()}]`], () => {
                                execFile('git', ['push', 'origin', 'main'], () => {});
                            });
                        });
                    }

                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify({ success: true, config: newConfig, githubSync }));
                });
            } catch (errParse) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: 'JSON inválido: ' + errParse.message }));
            }
        });
        return;
    }

    // Normalizar ruta
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
    }

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Si no existe, servir index.html
            const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
            fs.readFile(fallbackPath, (fbErr, content) => {
                if (fbErr) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 Not Found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            });
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (readErr, content) => {
            if (readErr) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('500 Internal Server Error');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
    });
});

function startServer(port) {
    server.listen(port, () => {
        console.log(`Servidor activo en: http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Puerto ${port} ocupado, intentando con ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Error al iniciar el servidor:', err);
        }
    });
}

startServer(PORT);
