import { base44 } from './base44Client';

// Only unrestricted upload integrations are exposed to the client.
// Restricted Core integrations (InvokeLLM, SendEmail, GenerateImage, …) run
// server-side inside backend functions via base44.asServiceRole.
export const UploadFile = base44.integrations.Core.UploadFile;

export const UploadPrivateFile = base44.integrations.Core.UploadPrivateFile;