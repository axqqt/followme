const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios'); // For Gemini API requests
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require("@google/generative-ai");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Load Twitter API credentials from environment variables
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_TOKEN_SECRET,
});

// Helper function to log actions with a timestamp
const logAction = (action, userId) => {
  console.log(`[${new Date().toISOString()}] ${action} with user ID: ${userId}`);
};



// Function to interact with Gemini AI to generate personalized messages
const generateMessageWithGemini = async (userName, context) => {
  try {
    // Replace the URL and API key with your actual Gemini API endpoint and key
    const response = await axios.post('https://api.gemini-ai.com/generate', {
      prompt: `Write a professional and engaging outreach message for a Social Media Marketing Agency looking to help businesses improve their online presence. The message should address ${userName} and reflect their interest in digital marketing.`,
      context, // Additional context about your SMMA/SA
      max_tokens: 100,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`, // Use your Gemini API key
        'Content-Type': 'application/json',
      },
    });

    return response.data.message; // Return the generated message
  } catch (error) {
    console.error('Error generating message with Gemini:', error.message);
    return `Hi ${userName}, I’d love to connect and discuss how we can help you improve your brand’s online presence. Let’s chat!`;
  }
};

// Function to follow a user and send a DM
const followAndDM = async (userId, userName, context) => {
  try {
    // Follow the user
    await client.v2.follow(process.env.BOT_USER_ID, userId);
    logAction("Followed", userId);

    // Random delay between follow and DM
    await delay(randomDelay(5000, 15000)); // Wait between 5-15 seconds

    // Generate a personalized message with Gemini AI
    const message = await generateMessageWithGemini(userName, context);

    // Send a DM
    await client.v1.sendDm({
      recipient_id: userId,
      text: message,
    });
    logAction("Sent DM", userId);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
};

// Utility function to add a delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate a random delay within a specified range (in milliseconds)
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Main function to start the bot
const main = async () => {
  // Your SMMA/SA context to guide Gemini's AI response
  const context = "We specialize in helping businesses grow their online presence through tailored social media strategies, performance marketing, and cutting-edge automation tools.";

  // Array of users to follow and DM (include userName for personalization)
  const users = [
    { userId: 'user_id1', userName: 'John Doe' },
    { userId: 'user_id2', userName: 'Jane Smith' },
  ];

  for (const { userId, userName } of users) {
    await followAndDM(userId, userName, context);

    // Delay to stay within rate limits (randomized between 30 and 60 minutes)
    const delayTime = randomDelay(1800000, 3600000);
    console.log(`Sleeping for ${delayTime / 60000} minutes to avoid rate limits.`);
    await delay(delayTime);
  }
};

main().catch(console.error);
