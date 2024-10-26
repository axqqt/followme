// Load environment variables
require('dotenv').config();
const puppeteer = require('puppeteer');

// Instagram credentials from environment variables
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

// Safety limits
const MAX_FOLLOWS_PER_HOUR = 20;
const MAX_FOLLOWS_PER_DAY = 150;
const FOLLOW_DELAY = 5; // 5 seconds delay between follows (after first one)

class InstagramFollower {
    constructor() {
        this.followedToday = 0;
        this.followedThisHour = 0;
        this.hourStart = Date.now();
        this.isFirstFollow = true;
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
            this.followedThisHour = 0;
            this.hourStart = currentTime;
        }

        // Check hourly limit
        if (this.followedThisHour >= MAX_FOLLOWS_PER_HOUR) {
            const remainingTime = 3600 - ((currentTime - this.hourStart) / 1000);
            console.log(`Hourly limit reached. Waiting ${(remainingTime / 60).toFixed(2)} minutes...`);
            await this.sleep(remainingTime);
            this.followedThisHour = 0;
            this.hourStart = Date.now();
        }

        // Check daily limit
        if (this.followedToday >= MAX_FOLLOWS_PER_DAY) {
            console.log('Daily limit reached. Please try again tomorrow.');
            return false;
        }

        return true;
    }

    extractUsername(url) {
        try {
            if (url.includes('instagram.com')) {
                const username = url.split('instagram.com/')[1].split('/')[0];
                return username.replace('/', '');
            }
            return url.replace('/', '');
        } catch (error) {
            console.error('Error extracting username:', error);
            return url;
        }
    }

    async followUsers(targetProfile) {
        try {
            const username = this.extractUsername(targetProfile);
            console.log(`Going to ${username}'s profile...`);

            await this.page.goto(`https://www.instagram.com/${username}/`, {
                waitUntil: 'networkidle0'
            });
            await this.sleep(2);

            console.log('Opening followers list...');
            await this.page.waitForSelector('a[href$="/followers/"]');
            await this.page.click('a[href$="/followers/"]');
            await this.sleep(2);

            await this.page.waitForSelector('div[role="dialog"]');
            
            let previousFollowCount = 0;
            let noNewFollowsCount = 0;

            while (await this.checkLimits()) {
                try {
                    const followButtons = await this.page.$$('button');
                    
                    for (const button of followButtons) {
                        try {
                            const buttonText = await this.page.evaluate(el => el.textContent, button);
                            
                            if (buttonText === 'Follow') {
                                // First follow happens immediately
                                if (this.isFirstFollow) {
                                    console.log('First follow - no delay');
                                    this.isFirstFollow = false;
                                } else {
                                    // All subsequent follows have 5 second delay
                                    console.log(`Waiting ${FOLLOW_DELAY} seconds...`);
                                    await this.sleep(FOLLOW_DELAY);
                                }

                                await button.click();
                                
                                this.followedToday++;
                                this.followedThisHour++;
                                
                                console.log(`Followed ${this.followedToday} today, ${this.followedThisHour} this hour`);
                                
                                if (!(await this.checkLimits())) {
                                    return;
                                }
                            }
                        } catch (error) {
                            continue;
                        }
                    }

                    // Check if we're finding new people to follow
                    if (this.followedToday === previousFollowCount) {
                        noNewFollowsCount++;
                        if (noNewFollowsCount >= 3) {
                            console.log('No new users found after 3 attempts, ending...');
                            break;
                        }
                    } else {
                        noNewFollowsCount = 0;
                    }
                    previousFollowCount = this.followedToday;

                    // Scroll the followers list
                    await this.page.evaluate(() => {
                        const dialog = document.querySelector('div[role="dialog"]');
                        if (dialog) dialog.scrollTop = dialog.scrollHeight;
                    });
                    
                    await this.sleep(2);

                } catch (error) {
                    console.error('Error in follow loop:', error);
                    break;
                }
            }
        } catch (error) {
            console.error('Error following users:', error);
        }
    }

    async run(targetProfile) {
        try {
            await this.init();
            if (await this.login()) {
                await this.followUsers(targetProfile);
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
        const bot = new InstagramFollower();
        const targetProfile = process.argv[2] || await new Promise(resolve => {
            console.log('Enter Instagram profile URL or username:');
            process.stdin.once('data', data => {
                resolve(data.toString().trim());
            });
        });
        
        await bot.run(targetProfile);
    } catch (error) {
        console.error('Program failed:', error);
    }
};

run();
