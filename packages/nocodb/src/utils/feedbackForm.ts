import axios from 'axios';

export const getFeedBackForm = async () => {
  const feedbackUrl = process.env.ROWWEAVE_FEEDBACK_URL;
  if (!feedbackUrl) return { disabled: true };

  try {
    const response = await axios.get(feedbackUrl, { timeout: 5000 });
    return response.data;
  } catch (e) {
    return { error: e.message };
  }
};
