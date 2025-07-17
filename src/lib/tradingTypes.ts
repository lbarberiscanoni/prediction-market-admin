/**
 * Trading-related type definitions for the prediction market platform
 */

export interface Market {
  id: number;
  name: string;
  description: string;
  token_pool: number;
  market_maker: string;
  status?: 'open' | 'closed' | 'resolved';
  close_date?: string;
  created_at?: string;
  creator_id?: string;
  tags?: string[];
}

export interface Answer {
  id: number;
  name: string;
  tokens: number;
  market_id: number;
  created_at?: string;
  creator_id?: string;
}

export interface TradePreview {
  sharesReceived: number;
  avgPrice: number;
  priceImpact: number;
  newOdds: number;
  expectedProfit: number;
  isValid: boolean;
  error: string | null;
}

export interface UserBalance {
  balance: number;
  user_id: string;
}

export interface UserShares {
  [outcomeId: number]: number;
}

export interface TradeValidationResult {
  isValid: boolean;
  reason?: string;
  error?: string;
  details?: {
    userBalance?: number;
    userShares?: number;
    requiredAmount?: number;
    availableShares?: number;
  };
}

export interface Prediction {
  id?: number;
  predictionId?: number;
  user_id: string;
  market_id: number;
  outcome_id: number;
  shares_amt: number;
  market_odds: number;
  trade_value: number;
  trade_type: 'buy' | 'sell';
  created_at?: string;
  market?: Market;
  outcome?: Answer;
  outcomes?: Answer[];
}

export interface Profile {
  id: string;
  user_id: string;
  username?: string;
  email?: string;
  balance?: number;
  payment_id?: string | null;
  enable_email_notifications?: boolean;
  created_at?: string;
  absolute_returns?: number;
  roi?: number;
  payment_method?: string;
  iq?: number;
  iq_url?: string;
}

export interface Outcome {
  id: number;
  name: string;
  tokens: number;
  market_id?: number;
  created_at?: string;
  creator_id?: string;
}

export interface PnlMetrics {
  totalPNL: number;
  percentageChange: number;
  volumeTraded: number;
  marketsTraded: number;
}

export interface GroupedPrediction {
  market_id: number;
  market_name: string;
  outcome_id: number;
  outcome_name: string;
  total_shares: number;
  total_value: number;
  current_odds: number;
  market_status: 'open' | 'closed' | 'resolved';
  last_trade_date: string;
  predictions: Prediction[];
}

export interface LeaderboardEntry {
  user_id: string;
  username?: string;
  payment_id?: string | null;
  total_profit: number;
  percent_pnl: number;
  balance: number;
}

// Utility types for API responses
export interface MarketWithOutcomes extends Market {
  outcomes: Outcome[];
}

export interface PredictionWithDetails {
  id?: number;
  predictionId?: number;
  user_id: string;
  market_id: number;
  outcome_id: number;
  shares_amt: number;
  market_odds: number;
  trade_value: number;
  trade_type: 'buy' | 'sell';
  created_at?: string;
  market: Market;
  outcome: Outcome;
  outcomes: Outcome[];
}

// Form-specific types
export interface TradeFormState {
  market: Market | null;
  answers: Answer[];
  totalPrice: number;
  computedShares: number;
  selectedAnswer: Answer | null;
  tradeType: 'buy' | 'sell';
  userBalance: number;
  userShares: UserShares;
  error: string | null;
  success: string | null;
}

export interface TradeFormProps {
  marketId?: number;
  onTradeComplete?: (trade: Prediction) => void;
  initialTradeType?: 'buy' | 'sell';
}

// Price change data for market cards
export interface PriceChangeData {
  currentPrice: number;
  previousPrice: number;
  changeAmount: number;
  changePercentage: number;
  hasData: boolean;
}

// Market odds for charts
export interface MarketOdds {
  timestamp: string;
  probability: number;
  shares_amt: number;
  trade_type: 'buy' | 'sell';
  outcome_name: string;
}