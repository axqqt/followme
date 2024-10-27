// Load environment variables
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Instagram credentials from environment variables
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

// Safety limits and configurations
const MAX_ACTIONS_PER_HOUR = 20;
const MAX_ACTIONS_PER_DAY = 150;
const ACTION_DELAY = 5; // seconds
const PROTECTION_PERIOD = 3; // days - don't unfollow users followed in the last X days

class UnfollowManager {
    constructor() {
        this.actionsToday = 0;
        this.actionsThisHour = 0;
        this.hourStart = Date.now();
        this.isFirstAction = true;
        this.following = new Set();
        this.followers = new Set();
        this.recentFollows = new Map(); // username -> timestamp
        this.dataFilePath = path.join(__dirname, 'recent_follows.json');
    }

    async sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    async loadRecentFollows() {
        try {
            const data = await fs.readFile(this.dataFilePath, 'utf8');
            const parsed = JSON.parse(data);
            this.recentFollows = new Map(Object.entries(parsed));
            console.log(`Loaded ${this.recentFollows.size} recent follows from file`);
        } catch (error) {
            console.log('No recent follows file found, starting fresh');
            this.recentFollows = new Map();
        }
    }

    async saveRecentFollows() {
        try {
            // Convert Map to object for JSON storage
            const recentFollowsObj = Object.fromEntries(this.recentFollows);
            await fs.writeFile(this.dataFilePath, JSON.stringify(recentFollowsObj, null, 2));
            console.log('Saved recent follows to file');
        } catch (error) {
            console.error('Error saving recent follows:', error);
        }
    }

    async init() {
        try {
            this.browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: ['--start-maximized']
            });
            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: 1280, height: 800 });
            await this.page.setDefaultTimeout(30000);
            
            await this.loadRecentFollows();
            console.log('Browser initialized');
        } catch (error) {
            console.error('Browser initialization failed:', error);
            throw error;
        }
    }

    async login() {
        try {
            console.log('Logging in...');
            await this.page.goto('https://www.instagram.com/accounts/login/', {
                waitUntil: 'networkidle0'
            });

            await this.page.waitForSelector('input[name="username"]');
            await this.page.type('input[name="username"]', INSTAGRAM_USERNAME, { delay: 100 });

            await this.page.waitForSelector('input[name="password"]');
            await this.page.type('input[name="password"]', INSTAGRAM_PASSWORD, { delay: 100 });

            await this.page.click('button[type="submit"]');
            await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
            
            // Handle "Save Info" popup
            try {
                await this.page.waitForSelector('button._acan._acap._acas', { timeout: 5000 });
                await this.page.click('button._acan._acap._acas');
            } catch (error) {
                console.log('No "Save Info" popup');
            }

            // Handle notifications popup
            try {
                await this.page.waitForSelector('button._a9--._a9_1', { timeout: 5000 });
                await this.page.click('button._a9--._a9_1');
            } catch (error) {
                console.log('No notifications popup');
            }

            console.log('Logged in successfully');
            return true;
        } catch (error) {
            console.error('Login failed:', error);
            return false;
        }
    }

    async checkLimits() {
        const currentTime = Date.now();

        // Reset hourly counter if an hour has passed
        if (currentTime - this.hourStart >= 3600000) {
            this.actionsThisHour = 0;
            this.hourStart = currentTime;
        }

        // Check hourly limit
        if (this.actionsThisHour >= MAX_ACTIONS_PER_HOUR) {
            const remainingTime = 3600 - ((currentTime - this.hourStart) / 1000);
            console.log(`Hourly limit reached. Waiting ${(remainingTime / 60).toFixed(2)} minutes...`);
            await this.sleep(remainingTime);
            this.actionsThisHour = 0;
            this.hourStart = Date.now();
        }

        // Check daily limit
        if (this.actionsToday >= MAX_ACTIONS_PER_DAY) {
            console.log('Daily limit reached. Please try again tomorrow.');
            return false;
        }

        return true;
    }

    async scrollAndCollectUsernames(selector) {
        const usernames = new Set();
        let previousHeight = 0;
        let noNewUsersCount = 0;

        while (noNewUsersCount < 3) {
            const currentUsernames = await this.page.evaluate((selector) => {
                const elements = document.querySelectorAll(selector);
                return Array.from(elements).map(el => el.textContent);
            }, selector);

            const initialSize = usernames.size;
            currentUsernames.forEach(username => usernames.add(username));

            if (usernames.size === initialSize) {
                noNewUsersCount++;
            } else {
                noNewUsersCount = 0;
            }

            // Scroll the list
            await this.page.evaluate(() => {
                const dialog = document.querySelector('div[role="dialog"]');
                if (dialog) dialog.scrollTop = dialog.scrollHeight;
            });

            await this.sleep(2);

            const currentHeight = await this.page.evaluate(() => {
                const dialog = document.querySelector('div[role="dialog"]');
                return dialog ? dialog.scrollHeight : 0;
            });

            if (currentHeight === previousHeight) {
                noNewUsersCount++;
            }

            previousHeight = currentHeight;
        }

        return usernames;
    }

    async getFollowersAndFollowing() {
        // Get followers
        console.log('Getting followers list...');
        await this.page.goto(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`);
        await this.sleep(2);
        await this.page.click('a[href$="/followers/"]');
        await this.sleep(2);
        this.followers = await this.scrollAndCollectUsernames('a.x1i10hfl');

        // Get following
        console.log('Getting following list...');
        await this.page.goto(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`);
        await this.sleep(2);
        await this.page.click('a[href$="/following/"]');
        await this.sleep(2);
        this.following = await this.scrollAndCollectUsernames('a.x1i10hfl');

        // Clean up old entries from recentFollows
        const protectionPeriodMs = PROTECTION_PERIOD * 24 * 60 * 60 * 1000;
        const now = Date.now();
        
        for (const [username, timestamp] of this.recentFollows) {
            if (now - timestamp > protectionPeriodMs) {
                this.recentFollows.delete(username);
                console.log(`Removed ${username} from protected list (protection period expired)`);
            }
        }

        // Find users not following back, excluding recent follows
        const notFollowingBack = new Set(
            [...this.following].filter(user => 
                !this.followers.has(user) && 
                !this.recentFollows.has(user)
            )
        );

        console.log(`Found ${notFollowingBack.size} users not following back (excluding ${this.recentFollows.size} protected recent follows)`);
        return notFollowingBack;
    }

    async unfollowUser(username) {
        try {
            await this.page.goto(`https://www.instagram.com/${username}/`);
            await this.sleep(2);

            // Click the Following button
            const followingButton = await this.page.$('button._acan._acap._acat');
            if (followingButton) {
                await followingButton.click();
                await this.sleep(1);

                // Click Unfollow in the popup
                const unfollowButton = await this.page.$('button._a9--._a9-_');
                if (unfollowButton) {
                    await unfollowButton.click();
                    this.actionsToday++;
                    this.actionsThisHour++;
                    console.log(`Unfollowed ${username} (${this.actionsToday} actions today, ${this.actionsThisHour} this hour)`);
                    return true;
                }
            }
        } catch (error) {
            console.error(`Error unfollowing ${username}:`, error);
        }
        return false;
    }

    async unfollowNonFollowers() {
        try {
            console.log('\nStarting unfollow process...');
            const notFollowingBack = await this.getFollowersAndFollowing();
            
            for (const username of notFollowingBack) {
                if (!(await this.checkLimits())) {
                    break;
                }

                if (!this.isFirstAction) {
                    console.log(`Waiting ${ACTION_DELAY} seconds...`);
                    await this.sleep(ACTION_DELAY);
                }
                this.isFirstAction = false;

                await this.unfollowUser(username);
            }

            await this.saveRecentFollows();
            console.log('Finished unfollowing non-followers');
        } catch (error) {
            console.error('Error in unfollow process:', error);
        }
    }

    async run() {
        try {
            await this.init();
            if (await this.login()) {
                await this.unfollowNonFollowers();
            } else {
                console.log('Login failed - check credentials');
            }
        } catch (error) {
            console.error('An error occurred:', error);
        } finally {
            await this.saveRecentFollows();
            await this.browser.close();
        }
    }
}

// Usage
const run = async () => {
    try {
        const bot = new UnfollowManager();
        await bot.run();
    } catch (error) {
        console.error('Program failed:', error);
    }
};

run();