"use client";

import React, { useState } from "react";
import supabase from "@/lib/supabase/createClient";

export default function Onboarding() {
  const [paymentEmail, setPaymentEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("Unable to retrieve user information. Please try again.");
      return;
    }

    // Find the player's existing profile so migrating users convert their
    // current row instead of creating a duplicate. Match on user_id first,
    // then fall back to email for older rows that were never linked to an
    // auth account. Only insert when no existing profile is found.
    let existingId: number | null = null;

    const { data: byUserId } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (byUserId) {
      existingId = byUserId.id;
    } else if (user.email) {
      const { data: byEmail } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", user.email)
        .maybeSingle();
      if (byEmail) existingId = byEmail.id;
    }

    const paymentFields = {
      user_id: user.id,
      email: user.email,
      payment_method: "PayPal", // enum "Payment Types"
      payment_id: paymentEmail, // PayPal email
    };

    const { error } =
      existingId != null
        ? await supabase.from("profiles").update(paymentFields).eq("id", existingId)
        : await supabase.from("profiles").insert(paymentFields);

    if (error) {
      setMessage("Error saving user information: " + error.message);
    } else {
      setMessage("Onboarding completed successfully!");
    }
  };

  return (
    <div className="container mx-auto mt-8 p-4 max-w-md bg-white text-black rounded shadow">
      <h2 className="text-xl font-bold mb-4">Complete Your Onboarding</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-2 font-semibold">PayPal Email</label>
          <input
            type="email"
            value={paymentEmail}
            onChange={(e) => setPaymentEmail(e.target.value)}
            required
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <p>IQ Test</p>
        </div>

        <button
          type="submit"
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          Submit
        </button>

        {message && <p className="mt-4 text-center text-red-500">{message}</p>}
      </form>
    </div>
  );
}
