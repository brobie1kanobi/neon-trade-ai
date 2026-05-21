# Base44 App
# Neon-Trade-AI
**Neon Trade AI** is an open-source, AI-enhanced trading platform built for full customization and user control. Analyze markets, automate strategies, manage portfolios, and create your own trading logic with a modular system designed for traders, developers, and AI experimentation.
**Notes:**
A Base44 Builder plan AND Kraken Pro plan are currently required to operate this, but I hope to phase that out once self-hosting operation is obtainable.

**How to setup:**

# NeonTrade AI: Autonomous Trading and Market Intelligence Platform

## Table of Contents

1.  [Overview](#1-overview)
2.  [Features](#2-features)
3.  [Prerequisites](#3-prerequisites)
4.  [Setup Guide](#4-setup-guide)
    *   [4.1. Create Your Base44 App](#41-create-your-base44-app)
    *   [4.2. Clone the Repository (Optional, for advanced users)](#42-clone-the-repository-optional-for-advanced-users)
    *   [4.3. Configure Environment Variables / Secrets](#43-configure-environment-variables--secrets)
    *   [4.4. Connect Kraken Exchange](#44-connect-kraken-exchange)
    *   [4.5. Set Up GitHub Integrations (Optional)](#45-set-up-github-integrations-optional)
        *   [4.5.1. GitHub Webhook for Marketplace](#451-github-webhook-for-marketplace)
        *   [4.5.2. GitHub Repository Connection](#452-github-repository-connection)
5.  [Running the Application](#5-running-the-application)
6.  [Using NeonTrade AI](#6-using-neontrade-ai)
    *   [6.1. Simulation Mode (Recommended First Step)](#61-simulation-mode-recommended-first-step)
    *   [6.2. Auto-Trader & AI Signals](#62-auto-trader--ai-signals)
    *   [6.3. Portfolio Management](#63-portfolio-management)
    *   [6.4. Settings & Customization](#64-settings--customization)
7.  [Troubleshooting](#7-troubleshooting)
8.  [Support](#8-support)

---

## 1. Overview

NeonTrade AI is an advanced autonomous trading and market intelligence platform designed to help users manage and optimize their cryptocurrency and stock investments. Leveraging cutting-edge AI, it provides real-time market analysis, automated trading signals, portfolio management tools, and integrations with major exchanges like Kraken.

## 2. Features

*   **AI-Powered Trade Signals:** Receive intelligent buy/sell recommendations based on market data.
*   **Automated Trading:** Configure strategies for hands-free trade execution on Kraken.
*   **Portfolio Management:** Track holdings, performance, and allocations in real-time.
*   **Simulation Mode:** Practice trading strategies without real financial risk.
*   **Advanced Analytics:** Gain insights into market trends and asset performance.
*   **GitHub Integration:** Connect with GitHub for various development and marketplace functionalities.
*   **User Settings:** Extensive customization options for preferences, notifications, and risk management.

## 3. Prerequisites

Before you begin, ensure you have:

*   A **Base44.com account**: This is where your NeonTrade AI application will be hosted and managed.
*   A **Kraken Exchange account**: For live trading and real-time market data. You will need API keys with appropriate permissions.
*   (Optional) A **GitHub account**: If you plan to use GitHub integration features, such as connecting to your repositories or the GitHub Marketplace.

## 4. Setup Guide

### 4.1. Create Your Base44 App

1.  Log in to your Base44.com account and sign up for a "Builder" plan (needed for backend functionality).
2.  Create a new application or import the NeonTrade AI template/codebase provided.
3.  Your app will be automatically provisioned and the frontend/backend will be deployed.

### 4.2. Clone the Repository (Optional, for advanced users)

If you wish to make local modifications to the code:

1.  Go to your Base44 app dashboard.
2.  Navigate to the "Code" section.
3.  Follow the instructions to connect to your GitHub repository and clone the project locally.

### 4.3. Configure Environment Variables / Secrets

Critical API keys and secrets must be securely stored as environment variables in your Base44 app.

1.  Go to your Base44 app dashboard.
2.  Navigate to "Secrets" -> "Add Secret".
3.  Add the following secrets:
    *   **`Kraken_API_Key` and `Trade_Key`**: Your Kraken API keys, 1 with query (balance requesting) only and 1 with all permissions enabled for trading.
    *   **`Kraken_API_Secret` and `Trade_Secret`**: Your Kraken API secrets (corresponding to the keys above).
    *   (Optional) **`COINGECKO_API_KEY`**: If you have a CoinGecko API key for enhanced market data.
    *   (Optional, for GitHub Marketplace Webhooks) **`GITHUB_MARKETPLACE_WEBHOOK_SECRET`**: A strong, random string you generate. This must match the secret set in GitHub.

### 4.4. Connect Kraken Exchange

The application will attempt to connect to Kraken using the `Kraken_API_Key`s and `Kraken_API_Secret`s you provided. Ensure these are correct for full functionality.

### 4.5. Set Up GitHub Integrations (Optional)

NeonTrade AI offers powerful integrations with GitHub.

#### 4.5.1. GitHub Webhook for Marketplace

If you are integrating with the GitHub Marketplace (e.g., for subscription events, listing management):

1.  **Get your Webhook URL**:
    *   In your NeonTrade AI app, go to "Settings" (frontend UI).
    *   Click on the "GitHub Marketplace" integration card.
    *   You will find your unique "Payload URL" displayed there (e.g., `https://[your-app-id].base44.com/githubMarketplaceWebhook`). Copy this URL.
2.  **Configure in GitHub**:
    *   Go to your GitHub Marketplace listing settings.
    *   Add a new webhook.
    *   **Payload URL**: Paste the URL copied from your NeonTrade AI app.
    *   **Content type**: Select `application/json`.
    *   **Secret**: Use the **exact same strong, random string** that you saved as `GITHUB_MARKETPLACE_WEBHOOK_SECRET` in your Base44 environment variables.
    *   Choose the events you want to subscribe to (e.g., `marketplace_purchase`).

#### 4.5.2. GitHub Repository Connection

To enable features that interact with your GitHub repositories (e.g., pushing configuration files, managing code):

1.  In your NeonTrade AI app, go to "Settings" -> "GitHub Integration".
2.  Click the "Connect GitHub Account" button.
3.  You will be redirected to GitHub for OAuth authorization. Follow the prompts to grant NeonTrade AI the necessary permissions (e.g., `repo` scope).
4.  Once authorized, you can manage repositories directly from the app interface.

## 5. Running the Application

Once your Base44 app is deployed and configured, simply navigate to your app's URL (e.g., `https://[your-app-id].base44.com`) in your web browser. The app should load automatically.

## 6. Using NeonTrade AI

### 6.1. Simulation Mode (Recommended First Step)

By default, NeonTrade AI starts in **Simulation Mode** (check your "Trading Settings" in the app's settings). This allows you to explore all features, test strategies, and understand the platform without risking real funds. Your portfolio and trades will operate with virtual money.

### 6.2. Auto-Trader & AI Signals

*   **AI Trader:** Configure your AI trading preferences, risk parameters, and watchlists.
*   **Auto-Trader Prospects:** View AI-generated trade signals and manually execute them or let the automated system handle it.
*   **Trading Strategies:** Explore and apply various trading strategies.

### 6.3. Portfolio Management

*   **Dashboard:** Get an overview of your portfolio, market insights, and recent activity.
*   **Portfolio Page:** Detailed breakdown of your holdings, profit/loss, and asset allocation.
*   **Wallet:** Manage your mock (simulation) or real (live) cash balances.

### 6.4. Settings & Customization

The "Settings" page allows you to:

*   Toggle Dark Mode.
*   Enable/disable auto-trading.
*   Manage notification preferences.
*   Connect bank accounts (for live trading).
*   Customize AI voice and speech settings.
*   Configure biometrics for secure login.
*   Adjust risk management parameters.
*   Manage GitHub connections.

## 7. Troubleshooting

*   **App not loading**: Check your browser's console for errors. Ensure all environment variables are correctly set in Base44.
*   **Kraken connection issues**: Verify your Kraken API key and secret. Ensure they have the correct permissions on Kraken's website.
*   **No trade signals**: Ensure you have assets configured in your auto-trading preferences and that the AI has sufficient time to analyze market data.
*   **GitHub webhook not firing**: Double-check the Payload URL and Secret in both GitHub and your Base44 environment variables.

## 8. Support

For any issues or questions, please refer to the Base44 documentation or contact Base44 support.
