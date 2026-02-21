const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided. Access denied.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, email, role, assignedCollegeIds, collegeId }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

function adminOrCollege(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'college') {
        return res.status(403).json({ error: 'Admin or College access required.' });
    }
    next();
}

function collegeOnly(req, res, next) {
    if (req.user.role !== 'college') {
        return res.status(403).json({ error: 'College access required.' });
    }
    next();
}

module.exports = { authMiddleware, adminOnly, adminOrCollege, collegeOnly };
