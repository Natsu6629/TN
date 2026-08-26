const express = require('express');
const session = require('express-session');
const axios = require('axios'); // ou fetch natif selon ta version de Node
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Configuration de la session
app.use(session({
    secret: 'votre_secret_session_super_securise',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 } // 24h
}));

// Variables d'environnement (à configurer dans les paramètres Render)
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://tn-11cs.onrender.com/api/auth/callback';

// 1. Redirection vers Discord
app.get('/api/auth/login', (req, res) => {
    const discordUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordUrl);
});

// 2. Callback OAuth Discord
app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');

    try {
        // Échange du code contre un token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // Récupération du profil utilisateur
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const userData = userResponse.data;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        // Sauvegarde de l'utilisateur en session
        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: avatarUrl
        };

        res.redirect('/');
    } catch (error) {
        console.error('Erreur OAuth Discord:', error.response?.data || error.message);
        res.redirect('/?error=auth_failed');
    }
});

// 3. Endpoint de vérification de session (appelé par index.html)
app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// 4. Déconnexion
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});
