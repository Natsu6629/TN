require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_de_session_securise',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
}));

let unitesActives = [];

const CLIENT_ID = String(process.env.CLIENT_ID || '1542015866563076116').trim();
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback';
const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize?client_id=1542015866563076116&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback&scope=identify+guilds.members.read';

// Role spécifique requis
const TARGET_ROLE_ID = process.env.REQUIRED_ROLE_ID || '1540922728675016794';

// 1. Authentification Discord (Login Direct)
app.get('/api/auth/login', (req, res) => {
    res.redirect(DISCORD_AUTH_URL);
});

// 2. Callback OAuth2
app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Code de connexion manquant.');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const discordUser = userResponse.data;

        // Vérification du rôle sur le serveur Discord
        const memberResponse = await axios.get(
            `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordUser.id}`,
            { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
        );

        const memberData = memberResponse.data;
        const roles = memberData.roles || [];

        if (!roles.includes(TARGET_ROLE_ID)) {
            return res.status(403).send(`
                <h2>Accès refusé</h2>
                <p>Vous n'avez pas le rôle requis sur le serveur Discord pour accéder à la centrale Transmission Nationale.</p>
                <a href="/">Retour à l'accueil</a>
            `);
        }

        req.session.user = {
            id: discordUser.id,
            username: memberData.nick || discordUser.global_name || discordUser.username,
            avatar: discordUser.avatar 
                ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                : 'https://cdn.discordapp.com/embed/avatars/0.png'
        };

        res.redirect('/');
    } catch (error) {
        console.error('Erreur OAuth2 :', error.response?.data || error.message);
        res.status(500).send('Erreur lors de la connexion. Vérifiez le fichier .env.');
    }
});

// 3. État utilisateur
app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// 4. Récupérer les agents ayant le rôle spécifique (1540922728675016794)
app.get('/api/members', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });

    try {
        const response = await axios.get(
            `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
            { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
        );

        const eligibleMembers = response.data
            .filter(member => member.roles && member.roles.includes(TARGET_ROLE_ID))
            .map(member => ({
                id: member.user.id,
                username: member.nick || member.user.global_name || member.user.username,
                avatar: member.user.avatar 
                    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
                    : 'https://cdn.discordapp.com/embed/avatars/0.png'
            }));

        res.json(eligibleMembers);
    } catch (error) {
        console.error('Erreur lors de la récupération des membres :', error.response?.data || error.message);
        res.status(500).json({ error: 'Impossible de récupérer la liste des membres.' });
    }
});

// 5. Déconnexion
app.get('/api/auth/logout', (req, res) => {
    if (req.session.user) {
        unitesActives = unitesActives.filter(u => u.userId !== req.session.user.id);
    }
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// 6. Gestion des unités
app.get('/api/unites', (req, res) => {
    res.json(unitesActives);
});

app.post('/api/unites/prise-de-service', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });

    const { indicatif, division, armement, statut, coéquipiers } = req.body;
    unitesActives = unitesActives.filter(u => u.userId !== req.session.user.id);

    const effectifsComplets = coéquipiers 
        ? `${req.session.user.username}, ${coéquipiers}` 
        : req.session.user.username;

    const nouvelleUnite = {
        userId: req.session.user.id,
        indicatif: indicatif || `Unité de ${req.session.user.username}`,
        division: division || 'Sécurité Publique (Standard)',
        armement: armement || 'Léger',
        effectifs: effectifsComplets,
        statut: statut || 'En patrouille'
    };

    unitesActives.push(nouvelleUnite);
    res.json({ success: true, unite: nouvelleUnite });
});

app.put('/api/unites/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (unitesActives[index]) {
        if (req.body.statut) unitesActives[index].statut = req.body.statut;
        if (req.body.effectifs) unitesActives[index].effectifs = req.body.effectifs;
        res.json({ success: true, unite: unitesActives[index] });
    } else {
        res.status(404).json({ error: 'Unité introuvable' });
    }
});

app.delete('/api/unites/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (unitesActives[index]) {
        unitesActives.splice(index, 1);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Unité introuvable' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Transmission Nationale prêt sur http://localhost:${PORT}`);
});