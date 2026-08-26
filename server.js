const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'transmission_secret_key_12345',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
}));

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://tn-11cs.onrender.com/api/auth/callback';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const ROLE_ID = '1540922728675016794';

let unitesActives = [];

// 1. Authentification OAuth2
app.get('/api/auth/login', (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send("Erreur : DISCORD_CLIENT_ID non configuré sur Render.");
    }
    const discordUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');

    try {
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

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const userData = userResponse.data;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

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

app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// 2. Récupération des agents via le Bot Discord (Filtre par Rôle)
app.get('/api/members', async (req, res) => {
    if (!BOT_TOKEN || !GUILD_ID) {
        return res.status(500).json({ error: "DISCORD_BOT_TOKEN ou GUILD_ID non configuré sur Render." });
    }

    try {
        const response = await axios.get(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`, {
            headers: {
                Authorization: `Bot ${BOT_TOKEN}`
            }
        });

        const membresFiltres = response.data
            .filter(member => member.roles && member.roles.includes(ROLE_ID))
            .map(member => {
                const user = member.user;
                const avatar = user.avatar
                    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                    : 'https://cdn.discordapp.com/embed/avatars/0.png';
                
                return {
                    id: user.id,
                    username: member.nick || user.global_name || user.username,
                    avatar: avatar
                };
            });

        res.json(membresFiltres);
    } catch (error) {
        console.error('Erreur API Discord Members:', error.response?.data || error.message);
        res.status(500).json({ error: "Impossible de récupérer les membres." });
    }
});

// 3. Gestion des Unités
app.get('/api/unites', (req, res) => {
    res.json(unitesActives);
});

app.post('/api/unites/prise-de-service', (req, res) => {
    const { indicatif, division, armement, statut, coéquipiers } = req.body;
    const effectifs = req.session.user 
        ? (coéquipiers ? `${req.session.user.username}, ${coéquipiers}` : req.session.user.username)
        : (coéquipiers || 'Agent inconnu');

    const nouvelleUnite = {
        indicatif,
        division,
        armement,
        statut: statut || 'En patrouille',
        effectifs
    };

    unitesActives.push(nouvelleUnite);
    res.json({ success: true, unite: nouvelleUnite });
});

app.put('/api/unites/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (unitesActives[index]) {
        if (req.body.statut) unitesActives[index].statut = req.body.statut;
        if (req.body.effectifs) unitesActives[index].effectifs = req.body.effectifs;
        res.json({ success: true, unite: unitesActives[index] });
    } else {
        res.status(404).json({ error: "Unité introuvable" });
    }
});

app.delete('/api/unites/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (unitesActives[index]) {
        unitesActives.splice(index, 1);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Unité introuvable" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
