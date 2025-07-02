// src/lib/getActiveUsers.ts
import supabase from "@/lib/supabase/createClient";

export interface ActiveUser {
  user_id: string;
  username?: string;
  email?: string;
  payment_id?: string;
  payment_method?: 'PayPal' | 'MTurk';
  balance?: number;
  prediction_count: number;
  total_trade_value: number; // Changed from total_amount_predicted
  last_prediction_date: string;
  first_prediction_date: string;
}

export interface ActiveUsersOptions {
  days?: number;
  includeProfileData?: boolean;
  minPredictions?: number;
}

/**
 * Get users who have made predictions in the last N days
 * @param options Configuration options
 * @returns Promise<ActiveUser[]>
 */
export async function getActiveUsers(options: ActiveUsersOptions = {}): Promise<ActiveUser[]> {
  const {
    days = 14,
    includeProfileData = true,
    minPredictions = 1
  } = options;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  try {
    // First, get predictions from the specified period
    // Based on your codebase, the correct columns are shares_amt, trade_value, etc.
    const { data: predictions, error: predictionsError } = await supabase
      .from('predictions')
      .select('user_id, shares_amt, trade_value, created_at')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (predictionsError) {
      throw new Error(`Error fetching predictions: ${predictionsError.message}`);
    }

    if (!predictions || predictions.length === 0) {
      return [];
    }

    // Group predictions by user and calculate stats
    const userStatsMap = new Map<string, {
      user_id: string;
      prediction_count: number;
      total_trade_value: number;
      last_prediction_date: string;
      first_prediction_date: string;
    }>();

    predictions.forEach(prediction => {
      const userId = prediction.user_id;
      const amount = prediction.trade_value || 0; // Using trade_value instead of predict_amt
      const date = prediction.created_at;

      if (!userStatsMap.has(userId)) {
        userStatsMap.set(userId, {
          user_id: userId,
          prediction_count: 0,
          total_trade_value: 0, // Changed from total_amount_predicted
          last_prediction_date: date,
          first_prediction_date: date
        });
      }

      const userStats = userStatsMap.get(userId)!;
      userStats.prediction_count += 1;
      userStats.total_trade_value += amount; // Changed from total_amount_predicted

      // Update first and last prediction dates
      if (new Date(date) > new Date(userStats.last_prediction_date)) {
        userStats.last_prediction_date = date;
      }
      if (new Date(date) < new Date(userStats.first_prediction_date)) {
        userStats.first_prediction_date = date;
      }
    });

    // Filter users based on minimum predictions
    const filteredUsers = Array.from(userStatsMap.values())
      .filter(user => user.prediction_count >= minPredictions);

    // If profile data is not needed, return basic stats
    if (!includeProfileData) {
      return filteredUsers.map(user => ({
        ...user,
        username: undefined,
        email: undefined,
        payment_id: undefined,
        payment_method: undefined,
        balance: undefined
      }));
    }

    // Get profile data for active users
    const userIds = filteredUsers.map(user => user.user_id);
    
    if (userIds.length === 0) {
      return [];
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, email, payment_id, payment_method, balance')
      .in('id', userIds);

    if (profilesError) {
      console.warn('Error fetching profiles:', profilesError.message);
      // Return users without profile data if profiles fetch fails
      return filteredUsers.map(user => ({
        ...user,
        username: undefined,
        email: undefined,
        payment_id: undefined,
        payment_method: undefined,
        balance: undefined
      }));
    }

    // Combine prediction stats with profile data
    const activeUsers: ActiveUser[] = filteredUsers.map(userStats => {
      const profile = profiles?.find(p => p.id === userStats.user_id);
      
      return {
        user_id: userStats.user_id,
        username: profile?.username,
        email: profile?.email,
        payment_id: profile?.payment_id,
        payment_method: profile?.payment_method as 'PayPal' | 'MTurk' | undefined,
        balance: profile?.balance,
        prediction_count: userStats.prediction_count,
        total_trade_value: userStats.total_trade_value, // Changed from total_amount_predicted
        last_prediction_date: userStats.last_prediction_date,
        first_prediction_date: userStats.first_prediction_date
      };
    });

    // Sort by prediction count (most active first)
    return activeUsers.sort((a, b) => b.prediction_count - a.prediction_count);

  } catch (error) {
    console.error('Error in getActiveUsers:', error);
    throw error;
  }
}

/**
 * Get simple list of user IDs who made predictions in the last N days
 * @param days Number of days to look back (default: 14)
 * @returns Promise<string[]>
 */
export async function getActiveUserIds(days: number = 14): Promise<string[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  try {
    const { data: predictions, error } = await supabase
      .from('predictions')
      .select('user_id')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (error) {
      throw new Error(`Error fetching active user IDs: ${error.message}`);
    }

    if (!predictions) {
      return [];
    }

    // Get unique user IDs
    const uniqueUserIds = [...new Set(predictions.map(p => p.user_id))];
    return uniqueUserIds;

  } catch (error) {
    console.error('Error in getActiveUserIds:', error);
    throw error;
  }
}

/**
 * Get count of active users in the last N days
 * @param days Number of days to look back (default: 14)
 * @returns Promise<number>
 */
export async function getActiveUserCount(days: number = 14): Promise<number> {
  try {
    const userIds = await getActiveUserIds(days);
    return userIds.length;
  } catch (error) {
    console.error('Error in getActiveUserCount:', error);
    return 0;
  }
}