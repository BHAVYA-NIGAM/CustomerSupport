const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { requireFields, cleanText } = require('../middleware/validate');

const router = express.Router();

router.post('/register', requireFields(['name', 'email', 'password', 'role']), async (req, res) => {
  try {
    const name = cleanText(req.body.name, 80);
    const email = cleanText(req.body.email, 120).toLowerCase();
    const role = ['agent', 'customer', 'admin'].includes(req.body.role) ? req.body.role : 'customer';

    if (req.body.password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email is already registered' });

    const password = await bcrypt.hash(req.body.password, 10);
    const user = await User.create({ name, email, password, role });
    const token = signToken(user);

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not register user' });
  }
});

router.post('/login', requireFields(['email', 'password']), async (req, res) => {
  try {
    const email = cleanText(req.body.email, 120).toLowerCase();
    const user = await User.findOne({ email });

    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not log in' });
  }
});

module.exports = router;
