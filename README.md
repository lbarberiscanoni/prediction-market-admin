# Prophet: Prediction Market Platform

## Project Overview

Prophet is a web-based prediction market platform where users can trade on the outcomes of future events. The platform uses automated market makers to facilitate trading and price discovery without requiring traditional order books.

## Key Features

### Binary Markets
Users can create and trade on binary outcome markets (typically Yes/No questions):
1. Users choose a market and select an outcome (e.g., "Yes" or "No")
2. Users specify how much they want to spend
3. The CPMM algorithm calculates how many outcome shares they receive
4. If the chosen outcome occurs, shares are worth $1 each; if not, they're worth $0
5. When events resolve, market creators can select the winning outcome and users' positions are settled accordingly

### Automated Market Making
Uses Constant Product Market Maker (CPMM) algorithm to determine prices:
- The product of token pools remains constant (x * y = k)
- Trades change the ratio between token pools, which changes the price
- The market maker automatically adjusts prices based on supply and demand

### Additional Features
- **User Authentication**: Complete login/signup flow with Supabase authentication
- **User Profiles**: Personal dashboards showing trading history and portfolio performance
- **Market Creation**: Interface for users to create new prediction markets
- **Market Browsing**: Ability to view and filter available markets

## Project Structure

### Frontend Structure
- `/src/app`: Next.js app router pages and routes
  - `/app/page.tsx`: Main landing page showing markets list
  - `/app/markets`: Markets browsing pages
    - `/app/markets/[id]/page.tsx`: Individual market details and trading interface
  - `/app/profile/page.tsx`: User profile dashboard 
  - `/app/market_maker/page.tsx`: Testing page for market maker algorithms
  - `/app/auth`: Authentication-related pages
    - `/app/auth/callback/route.ts`: OAuth callback route
    - `/app/auth/auth-error/page.tsx`: Error handling for auth
  - `/app/admin`: Admin page for market management
  - `/app/layout.tsx`: Root layout with global styling

### Components
- `/src/components`: Reusable React components
  - `CreateMarket.tsx`: Form for creating new prediction markets
  - `CPMM.tsx`: Component handling constant product market maker logic
  - `Leaderboard.tsx`: Displays user rankings
  - `ManageMarket.tsx`: Component for market management
  - `MarketTable.tsx`: Displays filterable list of available markets
  - `Onboarding.tsx`: User onboarding flow
  - `PredictionHistory.tsx`: Component for viewing prediction history
  - `Profile.tsx`: Profile display component
  - `ProfilesList.tsx`: Component for viewing all profiles (admin)
  - `navbar.tsx`: Site-wide navigation component
  - Authentication components:
    - `login-button.tsx` & `logout-button.tsx`: Authentication controls

### Business Logic
- `/src/lib`: Utility functions and business logic
  - `/lib/marketMakers.ts`: Implementation of market maker algorithms
    - `constantProductMarketMaker()`: Core function for CPMM calculations
  - `/lib/predictions.ts`: Trading functionality
    - `addPrediction()`: Handles trade execution and database updates
  - `/lib/addMarket.ts`: Functions for creating new markets
  - `/lib/addAnswers.ts`: Functions for adding outcomes to markets
  - `/lib/getMarkets.ts`: Functions for retrieving market data
  - `/lib/constants.ts`: Application-wide constants like market tags
  - `/lib/types.ts`: TypeScript type definitions
  - `/lib/supabase`: Supabase client initialization
    - `browser-client.ts`: Client for browser environment
    - `server-client.ts`: Client for server environment
    - `createClient.ts`: General client creation

### Static Assets
- `/public`: Static assets including SVG icons

### Middleware and Configuration
- `/src/middleware.ts`: Next.js middleware for route protection
- `next.config.ts`: Next.js configuration
- `tailwind.config.ts`: Tailwind CSS configuration
- `postcss.config.mjs`: PostCSS configuration
- `tsconfig.json`: TypeScript configuration

## Database Schema

### Markets
| Field | Description |
|-------|-------------|
| id | Unique identifier for the market |
| name | Market name/title |
| description | Detailed description of the market |
| token_pool | Total token count in the market |
| market_maker | Type of market maker (CPMM, Maniswap) |
| creator_id | ID of the user who created the market |
| created_at | Timestamp when market was created |
| tags | Array of tags for categorizing markets |

### Outcomes
| Field | Description |
|-------|-------------|
| id | Unique identifier for the outcome |
| name | Outcome name (e.g., "Yes" or "No") |
| market_id | Foreign key to markets table |
| creator_id | User who added this outcome |
| tokens | Token count allocated to this outcome |
| created_at | Timestamp when outcome was created |

### Predictions
| Field | Description |
|-------|-------------|
| id | Unique identifier for the prediction (trade) |
| user_id | User who made the prediction |
| market_id | Market the prediction was made on |
| outcome_id | The outcome that was predicted |
| predict_amt | Amount of currency spent on the prediction |
| return_amt | Amount of outcome shares received |
| created_at | Timestamp of the prediction |

### Profiles
| Field | Description |
|-------|-------------|
| id | Unique identifier (matches auth.users.id) |
| payment_type | User's payment method preference (PayPal/MTurk) |
| paypal_info | PayPal email address (if applicable) |
| mturk_info | MTurk ID (if applicable) |
| username | User's display name |
| balance | User's current token balance |

## Roadmap

- [x] Add resolve market button to market details page
- [x] Add annull market button to market details page
- [ ] Add prediction history component to player details page
- [ ] Add ability to update balance on player details page
- [ ] Payment Processing System
  - [x] Implement MTurk payment integration for user rewards
  - [x] Create admin dashboard for managing payments
  - [x] Bulk payment selection interface
  - [ ] Payment tracking with unique Payment IDs
  - [ ] MTurk Assignment ID linking
  - [ ] Custom amount fields for flexible compensation
  - [ ] Add payment history tracking for administrators
  - [ ] Implement payment status notifications for users
  - [ ] Create automated payment scheduling for regular payouts
  - [ ] Add support for alternative payment methods (PayPal, direct deposit)
  - [ ] Build reporting tools for payment reconciliation
- [ ] Automate market creation with recurring markets
- [ ] Analytics like manifold.stats
- [ ] Add an email after prizes & payments
- [ ] Crawler to duplicate markets from other sites
  - [ ] Economic Bureau https://www.census.gov/economic-indicators/#
  - [ ] Kalshi
  - [ ] Polymarket
  - [ ] Manifold
- [ ] Add $1 per player who played to the overall prize pool
- [ ] Forecasting analytics https://forecastapp.substack.com/p/whos-best-at-predicting-the-future
  - [ ] F-score give more weight to false positives and false negatives, whereas others, like area under curve measure accuracy as an integral of predicted performance in a two-dimensional space.
  - [ ] accuracy is the number of times you got a forecast right over the number of forecasts you made; your precision is how many times you correctly predicted Yes over the total number of Yeses you predicted; your recall is the number of times you correctly predicted Yes over the number of questions you forecasted that settled Yes. Related concepts, but all of them measure slightly different things.
  - [ ] Brier Score metrics don’t work for measuring user skill because Forecast doesn’t capture your predicted probability of an outcome - we only know your minimum predicted probability of the outcome. When you Buy the Yes for 25 points, we don’t know if you believe the probability is 30% or 90%, just that it’s greater than 25%.
- [ ] Advanced User Analytics Dashboard
  - [ ] Implement Brier score calculation for user forecasting accuracy
  - [ ] Track lifetime profit metrics for all users
  - [ ] Create visualization comparing Brier scores vs. profit rankings
  - [ ] Segment analysis by trading volume (low/medium/high activity users)
  - [ ] Add correlation statistics to help users understand forecasting skill vs. profitability
  - [ ] Include this as part of user profile statistics and platform-wide leaderboards
- [] Research & Analytics Dashboard
  - []  IQ tracking and distribution analysis
  - []  Implement IQ test integration for user cognitive assessment
  - [] Create visual distribution chart with statistical measures
  - []  Add filtering capabilities by IQ ranges
  - []  Platform engagement metrics
  - []  Track daily/weekly/monthly engagement rates
  - []  Visualize engagement trends over time
  - []  Correlate engagement spikes with platform events
  - []  Trading activity monitoring
  - []  Track order volumes and types
  - [] Create visualizations for trade frequency and size
  - []  Research tools for analyzing forecaster characteristics
  - []  Compare cognitive abilities with prediction accuracy
  - []  Examine relationships between IQ and trading behaviors
  - [] Generate downloadable datasets for academic research
  - []  Admin-facing analytics for platform performance
- [] User Management Dashboard
  - [] Implement comprehensive player/user listing interface
  - [] Display core user information (username, email)
  - [] Show trading activity metrics (last trade date, number of trades)
  - [] Add filtering and sorting capabilities
  - [] Filter by activity level (active/inactive users)
  - [] Sort by trade frequency or recency
  - [] Search functionality by username or email
  - [] Expand user management features
  - [] User account status management (active/suspended/deleted)
  - [] Permission level control
  - [] User verification tracking
  - [] Add user engagement metrics
  - [] Time since registration
  - [] Login frequency
  - [] Session duration statistics
  - [] Create user export functionality for data analysis
  - [] Implement bulk user actions (notifications, status changes)
- [] Combinatorial/Conditional Markets
  - []  Implement conditional market creation interface
  - []  Allow selection of base markets as conditions
  - []  Enable outcome pairing across different markets
  - []  Create intuitive UI for linking conditions to outcomes
  - []  Develop conditional probability calculation engine
  - []  Implement proper pricing for conditional outcomes
  - []  Handle dependencies between related markets
  - []  Add time-bounded market combinations
  - []  Support for different start/end dates for combinations
  - []  Time-dependent resolution rules
  - []  Create visualization tools for conditional probabilities
  - []  Display implied probabilities based on market conditions
  - []  Show relationship graphs between connected markets
  - []  Implement resolution logic for conditional markets
  - [] Automated resolution based on condition outcomes
  - []  Partial resolution for partially fulfilled conditions

## Development Status

### July 6, 2025
- Add page to view FRED data

### July 1, 2025
- Create debug component for viewing active users

### June 9, 2025
- Update leaderboard component with numbering

### June 3, 2025
- Update economic indicators page to display business formation data

### June 3, 2025
- Start economic indicators market page

### April 17, 2025
- Fix error on players and player details

### April 14, 2025
- Add individual player details page

### April 11, 2025
- Add page to view all players

### April 10, 2025
- Add market resolution to market info page
- Add market annullment option to market resolution

### May 22, 2025
- Update payment page for individual/batch payments
- Add option to pay active users for current cycle

### May 28, 2025
- Update leaderboard component