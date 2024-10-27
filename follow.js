// Load environment variables
require('dotenv').config();
const puppeteer = require('puppeteer');

// Instagram credentials from environment variables
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

// Safety limits - combined limits for all actions
const MAX_ACTIONS_PER_HOUR = 20;  // Instagram typically allows 20-25 actions per hour
const MAX_ACTIONS_PER_DAY = 150;  // Keep total daily actions under 150
const ACTION_DELAY = 5; // 5 seconds delay between actions

class InstagramManager {
    constructor() {
        this.actionsToday = 0;
        this.actionsThisHour = 0;
        this.hourStart = Date.now();
        this.isFirstAction = true;
        this.following = new Set();
        this.followers = new Set();
    }

    async sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
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

    async getLikersFromPost(postUrl) {
        try {
            console.log(`Going to post: ${postUrl}`);
            await this.page.goto(postUrl, { waitUntil: 'networkidle0' });
            await this.sleep(2);

            // Click on likes count to open likers dialog
            console.log('Opening likes list...');
            await this.page.waitForSelector('a[href*="/liked_by/"]');
            await this.page.click('a[href*="/liked_by/"]');
            await this.sleep(2);

            await this.page.waitForSelector('div[role="dialog"]');
            
            // Collect usernames of people who liked the post
            console.log('Collecting usernames of people who liked the post...');
            const likers = await this.scrollAndCollectUsernames('a.x1i10hfl');
            console.log(`Found ${likers.size} users who liked the post`);
            
            return likers;
        } catch (error) {
            console.error('Error getting post likers:', error);
            return new Set();
        }
    }

    async followUsers(postUrl) {
        try {
            const likers = await this.getLikersFromPost(postUrl);
            
            for (const username of likers) {
                if (!(await this.checkLimits())) {
                    break;
                }

                try {
                    // Go to user's profile
                    await this.page.goto(`https://www.instagram.com/${username}/`);
                    await this.sleep(2);

                    // Check for and click Follow button if present
                    const followButton = await this.page.$('button:not(._acan._acap._acat):contains("Follow")');
                    if (followButton) {
                        if (!this.isFirstAction) {
                            console.log(`Waiting ${ACTION_DELAY} seconds...`);
                            await this.sleep(ACTION_DELAY);
                        }
                        this.isFirstAction = false;

                        await followButton.click();
                        this.actionsToday++;
                        this.actionsThisHour++;
                        console.log(`Followed ${username} (${this.actionsToday} actions today, ${this.actionsThisHour} this hour)`);
                    }
                } catch (error) {
                    console.error(`Error following ${username}:`, error);
                    continue;
                }
            }
        } catch (error) {
            console.error('Error in follow process:', error);
        }
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

        // Find users not following back
        const notFollowingBack = new Set(
            [...this.following].filter(user => !this.followers.has(user))
        );

        console.log(`Found ${notFollowingBack.size} users not following back`);
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
            console.log('\nStarting unfollow phase...');
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

            console.log('Finished unfollowing non-followers');
        } catch (error) {
            console.error('Error in unfollow process:', error);
        }
    }

    async run(postUrl) {
        try {
            await this.init();
            if (await this.login()) {
                // First follow users who liked the post
                await this.followUsers(postUrl);
                
                // Then unfollow users who don't follow back
                await this.unfollowNonFollowers();
            } else {
                console.log('Login failed - check credentials');
            }
        } catch (error) {
            console.error('An error occurred:', error);
        } finally {
            await this.browser.close();
        }
    }
}

// Usage
const run = async () => {
    try {
        const bot = new InstagramManager();
        const postUrl = process.argv[2] || await new Promise(resolve => {
            console.log('Enter Instagram post URL:');
            process.stdin.once('data', data => {
                resolve(data.toString().trim());
            });
        });
        
        // Validate post URL
        if (!postUrl.includes('instagram.com/p/') && !postUrl.includes('instagram.com/reel/')) {
            throw new Error('Invalid Instagram post URL. Please provide a valid post or reel URL.');
        }
        
        await bot.run(postUrl);
    } catch (error) {
        console.error('Program failed:', error);
    }
};

run();