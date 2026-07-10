"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import supabase from '@/lib/supabase/createClient';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const router = useRouter();

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage('Login successful!');
      router.push('/');
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setMessage('Enter your email first, then click Forgot Password.');
      return;
    }

    const redirectTo = `${window.location.origin}/auth/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      console.error('Error sending password reset email:', error.message);
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage('Password reset email sent. Check your inbox for the recovery link.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md p-8 space-y-6 bg-white shadow-md rounded-md">
        <h1 className="text-2xl font-bold text-center text-gray-800">Welcome</h1>
        <p className="text-sm text-center text-gray-600">Sign in to your account</p>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded-md text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded-md text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="space-y-2">
          <button
            onClick={handleLogin}
            className="w-full px-4 py-2 text-white bg-green-500 rounded-md hover:bg-green-600 focus:outline-none"
          >
            Log In
          </button>
          <button
            onClick={handleForgotPassword}
            className="w-full px-4 py-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 focus:outline-none"
          >
            Forgot Password
          </button>
        </div>

        {message && <p className="text-sm text-center text-red-500">{message}</p>}
      </div>
    </div>
  );
}
