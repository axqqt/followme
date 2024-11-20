const { TwitterApi } = require("twitter-api-v2");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const ScrapFly = require("scrapfly-sdk"); // ScrapFly library
dotenv.config();

// Initialize ScrapFly API
const scrapfly = new ScrapFly({ apiKey: process.env.SCRAPFLY_API_KEY });

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Initialize Twitter API client
const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_TOKEN_SECRET,
});

// Helper function to log actions
const logAction = (action, detail) => {
  console.log(`[${new Date().toISOString()}] ${action}: ${detail}`);
};

// ScrapFly Function to Find Potential Clients
const findPotentialClients = async (keyword) => {
  try {
    const response = await scrapfly.scrape({
      url: `https://twitter.com/search?q=${encodeURIComponent(keyword)}&src=typed_query`,
      renderJavascript: true, // Enable JavaScript rendering for dynamic content
    });

    // Extract user IDs or handles from scraped HTML
    const users = []; // Process response.data.content to extract relevant data
    const regex = /"screen_name":"(.*?)"/g; // Example regex to find Twitter handles
    let match;
    while ((match = regex.exec(response.data.content)) !== null) {
      users.push(match[1]); // Collect Twitter handles
    }

    logAction("Found Potential Clients", `${users.length} users`);
    return users;
  } catch (error) {
    console.error("Error finding potential clients with ScrapFly:", error.message);
    return [];
  }
};

// Generate personalized responses using Gemini AI
const generateMessageWithGemini = async (userName, context, conversationHistory = []) => {
  try {
    let prompt;

    if (conversationHistory.length === 0) {
      prompt = `Write a professional and engaging follow-up message for a Social Media Marketing Agency. Address ${userName}, and offer personalized insights on how to improve their online presence. Include key benefits and be conversational.`;
    } else {
      const previousMessages = conversationHistory
        .map((message, index) => (index % 2 === 0 ? `You: ${message}` : `Recipient: ${message}`))
        .join("\n");
      prompt = `Continue the conversation naturally based on the following context and history:\n\nContext: ${context}\n\nConversation:\n${previousMessages}\n\nRecipient:`;
    }

    const result = await model.generateContent({
      prompt,
      max_tokens: 100,
    });

    return result.response.text.trim();
  } catch (error) {
    console.error("Error generating message with Gemini:", error.message);
    return `Hi ${userName}, I’d love to connect and discuss how we can help you improve your brand’s online presence. Let’s chat!`;
  }
};

// Follow and DM function
const followAndDM = async (userId, userName, context) => {
  try {
    await client.v2.follow(process.env.BOT_USER_ID, userId);
    logAction("Followed", userId);

    await delay(randomDelay(5000, 15000)); // Delay to mimic human behavior

    const introMessage = `Hi ${userName}, this is [Your Name] from [Your Agency]. We specialize in helping businesses grow their online presence. Let me know if you're open to a quick chat!`;
    await client.v1.sendDm({ recipient_id: userId, text: introMessage });
    logAction("Sent Intro DM", userId);

    const followUpMessage = await generateMessageWithGemini(userName, context);
    await delay(randomDelay(10000, 20000)); // Delay before follow-up
    await client.v1.sendDm({ recipient_id: userId, text: followUpMessage });
    logAction("Sent Follow-Up DM", userId);
  } catch (error) {
    console.error(`Error processing user ${userId}:`, error.message);
  }
};

// Delay utility
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate a random delay within a range
const randomDelay = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Main function
const main = async () => {
  const context =
    "We help businesses enhance their digital presence through targeted strategies, creative content, and automation tools.";
  const keyword = "looking for social media help"; // Example search keyword

  const potentialClients = await findPotentialClients(keyword);

  for (const userHandle of potentialClients) {
    const userId = await client.v2.userByUsername(userHandle); // Get user ID from handle
    if (userId) {
      await followAndDM(userId.data.id, userHandle, context);

      const delayTime = randomDelay(1800000, 3600000); // 30-60 mins
      console.log(`Sleeping for ${delayTime / 60000} minutes to avoid rate limits.`);
      await delay(delayTime);
    }
  }
};

// Start the bot
main().catch((error) =>
  console.error("Error in main function:", error.message)
);
