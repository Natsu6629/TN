const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key_default',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.get('/api/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=identify+guilds.members.read`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Code d’autorisation manquant.');

    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = tokenResponse.data;
        if (!tokenData.access_token) {
            return res.status(401).send('Échec de la récupération du token Discord.');
        }

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = userResponse.data;

        const memberResponse = await axios.get(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userData.id}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        const memberData = memberResponse.data;
        const hasRole = memberData.roles && memberData.roles.includes(REQUIRED_ROLE_ID);

        if (!hasRole) {
            return res.status(403).send('Accès refusé : rôle requis manquant.');
        }

        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : null,
            nickname: memberData.nick || userData.username
        };

        res.redirect('/');
    } catch (error) {
        console.error('Erreur lors de l’authentification :', error.response ? error.response.data : error.message);
        res.status(500).send('Erreur lors de la connexion à Discord.');
    }
});

app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
