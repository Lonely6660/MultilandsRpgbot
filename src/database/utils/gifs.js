/**
 * Gets custom rating GIF for a user
 * @param {string} userId - Discord user ID
 * @param {string} rating - Rating type (amazing, great, good, deflected)
 * @param {Object} pgClient - PostgreSQL client instance
 * @returns {Promise<string>} GIF URL
 */
async function getUserRatingGif(userId, rating, pgClient) {
  try {
    const query = 'SELECT gif_url FROM user_rating_gifs WHERE user_id = $1 AND rating = $2;';
    const result = await pgClient.query(query, [userId, rating]);
    
    if (result.rows.length > 0) {
      return result.rows[0].gif_url;
    }
    
    // Return default gifs if no custom ones found
    const defaultGifs = {
