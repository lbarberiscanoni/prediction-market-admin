import { AWSSignerV4 } from "https://deno.land/x/aws_sign_v4@1.0.2/mod.ts";

// Configure AWS credentials
const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID")!;
const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;

if (!accessKeyId || !secretAccessKey) {
  throw new Error("AWS credentials are not defined in the environment variables.");
}

const signer = new AWSSignerV4({ region: "us-east-1", service: "mturk-requester" });

export const handler = async (req: Request): Promise<Response> => {
  console.log("Checking environment variables...");

  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");

  console.log("AWS_ACCESS_KEY_ID:", accessKeyId);
  console.log("AWS_SECRET_ACCESS_KEY:", secretAccessKey ? "*******" : "undefined");

  if (!accessKeyId || !secretAccessKey) {
    console.error("Error: AWS credentials are not defined in the environment variables.");
    return new Response(
      JSON.stringify({ error: "AWS credentials are not defined in the environment variables." }),
      { status: 500 }
    );
  }

  console.log("Environment variables are set correctly.");
  return new Response(
    JSON.stringify({ message: "Environment variables are set correctly." }),
    { status: 200 }
  );
};
