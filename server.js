const express = require("express");
const path = require("path");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const GithubStrategy = require("passport-github2").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const dotenv = require('dotenv');


// Initialize environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));
app.use(
    session({
        secret: "keyboard cat",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
    })
);
app.use(passport.initialize());
app.use(passport.session());

// OAuth Credentials
const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CHANNEL_ID } = process.env;

// Passport Strategies
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL_GOOGLE,
    scope: ["https://www.googleapis.com/auth/youtube.readonly"],
}, (accessToken, _, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

passport.use(new GithubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL_GITHUB,
}, (accessToken, _, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/login_screen.html"));
});

// Google Authentication Routes
app.get("/auth/google", passport.authenticate("google", {
    scope: ["openid", "profile", "email", "https://www.googleapis.com/auth/youtube.readonly"],
}));

app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/" }), async (req, res) => {
    const { accessToken } = req.user;
    req.session.googleaccessToken = accessToken;

    try {
        const response = await axios.get(
            `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&forChannelId=${CHANNEL_ID}&mine=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const isSubscribed = response.data.items.length > 0;
        req.session.isSubscribed = isSubscribed;

        res.redirect(isSubscribed ? "/login/success" : "/youtube/verification/failed");
    } catch (error) {
        console.error("Error checking subscription:", error);
        res.send("Error checking subscription");
    }
});

// Github Authentication Routes
app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));

app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/" }), async (req, res) => {
    const { accessToken } = req.user;
    req.session.accessToken = accessToken;

    const octokit = new Octokit({ auth: accessToken });

    try {
        const response = await octokit.request("GET /user/following/bytemait", {
            headers: { "X-GitHub-Api-Version": "2022-11-28" },
        });

        res.redirect(response.status === 204 ? "/login/success" : "/github/verification/failed");
    } catch (error) {
        console.error("Error checking GitHub follow:", error);
        res.redirect("/github/verification/failed");
    }
});

// Middleware to ensure user is subscribed on YouTube
async function ensureSubscribed(req, res, next) {
    if (req.isAuthenticated() && req.session.googleaccessToken) {
        try {
            const response = await axios.get(
                `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&forChannelId=${CHANNEL_ID}&mine=true`,
                { headers: { Authorization: `Bearer ${req.session.googleaccessToken}` } }
            );
            req.session.isSubscribed = response.data.items.length > 0;
        } catch (error) {
            console.error("Error checking subscription:", error);
            req.session.isSubscribed = false;
        }
    } else {
        req.session.isSubscribed = null;
    }
    return next();
}

// Middleware to ensure user is following on GitHub
async function ensureFollowing(req, res, next) {
    if (req.isAuthenticated() && req.session.accessToken) {
        const octokit = new Octokit({ auth: req.session.accessToken });

        try {
            const response = await octokit.request("GET /user/following/bytemait", {
                headers: { "X-GitHub-Api-Version": "2022-11-28" },
            });
            req.session.isFollowing = response.status === 204;
        } catch (error) {
            console.error("Error checking GitHub follow:", error);
            req.session.isFollowing = false;
        }
    } else {
        req.session.isFollowing = null;
    }
    return next();
}

// Failure routes
app.get("/youtube/verification/failed", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, "public/youtube_verification_failed.html"));
    } else {
        res.redirect("/");
    }
});

app.get("/github/verification/failed", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, "public/github_verification_fail.html"));
    } else {
        res.redirect("/");
    }
});

app.get("/login/failed", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, "public/access_denied.html"));
    } else {
        res.redirect("/");
    }
});

// Success Route
app.get("/login/success", ensureSubscribed, ensureFollowing, (req, res) => {
    if (req.session.isSubscribed || req.session.isFollowing) {
        res.sendFile(path.join(__dirname, "public/success.html"));
    } else {
        res.redirect("/login/failed");
    }
});

app.get("/confirmation", (req, res) => {
    res.sendFile(path.join(__dirname, "public/testing.html"));
});


// Fallback route
app.get("*", (req, res) => res.redirect("/"));

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
