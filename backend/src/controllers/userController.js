import {
  getMeService,
  updateProfileService,
  updatePasswordService,
  getLoginHistoryService
} from '../services/userService.js';

// ====================== GET CURRENT USER ======================
export const getMe = async (req, res) => {
  try {
    const user = await getMeService(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ====================== UPDATE PROFILE ======================
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const result = await updateProfileService(userId, req.body, req.files || {}, req.user.role);

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ====================== LOGIN HISTORY ======================
export const getLoginHistory = async (req, res) => {
  try {
    const sessions = await getLoginHistoryService(req.user.userId);
    res.json(sessions);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ====================== UPDATE PASSWORD ======================
export const updatePassword = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;

    const result = await updatePasswordService(
      userId,
      currentPassword,
      newPassword
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};