# AI Assistant with Tool Agents

An extensible AI assistant powered by OpenAI's GPT-4o that integrates with Google Workspace and other services. Features a modular agent architecture for handling specialized tasks like calendar management, email, contacts, and more.

## Features

- 🤖 GPT-4o powered personal assistant
- 📅 Google Calendar integration
- 📧 Gmail integration
- 👥 Google Contacts management
- 📝 Google Docs integration
- 🌤️ Weather information
- 🔍 Internet search capabilities
- ➗ Basic calculations
- 💬 Multiple interfaces (Telegram bot & CLI)

## Architecture

The project uses a modular agent-based architecture where each capability is encapsulated in a specialized agent class. Key architectural components:

- `BaseOpenAIAgent`: Abstract base class providing common OpenAI integration functionality
- `ZodUtils`: Utility for converting Zod schemas to OpenAI function calls, dramatically reducing boilerplate
- Each agent extends BaseOpenAIAgent and defines its capabilities using Zod schemas

## Local Setup

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Google Cloud Platform account
- OpenAI API key
- Telegram Bot Token (optional, for bot interface)
- Perplexity API key (for internet search capabilities)
- OpenWeather API key

### Environment Setup

Create a `.env` file in the project root:
```
# OpenAI core bot and tool calling framework
OPENAI_API_KEY=

# Weather information
OPENWEATHER_API_KEY=

# IP address lookup used for location awareness of bot not client (future improvement opportunity initial use is only local)
IPINFO_TOKEN=

# Internet search via Perplexity
PERPLEXITY_API_KEY=

# Telegram bot interface for easy voice and text input on the go
TELEGRAM_BOT_TOKEN=
```

### Google Cloud Platform Setup
1. Create a new GCP project
2. Enable the following APIs:
   - Google Calendar API
   - Gmail API
   - Google People API (Contacts)
   - Google Drive API
   - Google Docs API

3. Configure OAuth Consent Screen:
   - Set application type to "Desktop app"
   - Add test users (required for development)
   - Add required scopes:
     - `https://www.googleapis.com/auth/contacts`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/drive`
     - `https://www.googleapis.com/auth/drive.file`
     - `profile`

4. Create OAuth Client ID:
   - Application type: Desktop
   - Download client secret JSON
   - Create `secrets` directory in project root
   - Save client secret JSON in `secrets` directory

### Installation

Install dependencies
```
pnpm install
```

Setup Google authentication
```
pnpm setup-google-auth
```

The setup script will open your browser for OAuth authentication. After authorizing, the token will be saved in `secrets/google-token.json`.

## Running the Application

### CLI Interface (Recommended for Testing)

```
pnpm run cli
```

### Telegram Bot Interface (main entry point)

```
pnpm run start
```

## Agent Capabilities

### Calendar Agent
- Schedule, update, and delete meetings
- Search for meetings in date ranges
- Handles Google Meet integration
- Manages attendees and meeting details

### Gmail Agent
- Search emails
- Read email content
- Create email drafts
- Support for HTML formatting

### Contacts Agent
- Find contacts by name or email
- Update contact details
- Manage contact information (phone, email, organization)

### Google Docs Agent
- Create new documents
- Read document content
- Update existing documents
- Search across documents

### Weather Agent
- Get current weather conditions
- Retrieve weather forecasts
- Support for location-based weather
- Temperature, humidity, wind data

### Internet Search Agent
- Real-time internet searches
- Detailed or concise results
- Powered by Perplexity API

### Calculator Agent
- Basic arithmetic operations
- Precise numerical calculations
- Error handling for invalid operations

## Contributing

Contributions are welcome! The modular agent architecture makes it easy to add new capabilities:

1. Create a new agent class extending `BaseOpenAIAgent`
2. Define capabilities using Zod schemas
3. Implement the required functionality
4. Add the agent to `PersonalAssistant`

## License

This project is licensed under the MIT License.



