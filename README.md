# 🎁 Bundle App - Premium Shopify Bundle Builder

[![Shopify App](https://img.shields.io/badge/Shopify-App-95BF47?style=for-the-badge&logo=shopify&logoColor=white)](https://shopify.dev)
[![Remix](https://img.shields.io/badge/Remix-000000?style=for-the-badge&logo=remix&logoColor=white)](https://remix.run)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://prisma.io)

> **Transform your Shopify store with revolutionary 3D product bundles that increase AOV and create unforgettable shopping experiences.**

## 🌟 Overview

Bundle App is a sophisticated Shopify application that enables merchants to create stunning product bundles with modern 3D carousel presentation, flexible pricing strategies, and advanced personalization features. Built with cutting-edge technology, it seamlessly integrates with Shopify themes to provide customers with an interactive and engaging bundle-building experience.

## ✨ Key Features

### 🎨 **3D Ring Carousel**
- Revolutionary 3D ring formation with configurable radius and tilt
- Multiple visual styles: Coverflow, Cube, Flip, Slide, and Center Pop
- Smooth 60fps animations with hardware acceleration
- Touch gestures, keyboard navigation, and accessibility support

### 🛍️ **Advanced Bundle Types**
- **Fixed Bundles**: Pre-configured product combinations
- **Mix & Match**: Customer choice within merchant-defined limits  
- **Build-a-Box**: Complete freedom from product collections

### 💰 **Intelligent Pricing Engine**
- Sum, Fixed, Percentage, and Amount discount pricing
- Tiered pricing for volume discounts
- Real-time price calculations with variant support
- Dynamic promotional pricing

### 🎁 **Premium Personalization**
- Gift wrapping with custom images and pricing
- Greeting card templates and custom uploads
- Personalized messages with character limits
- Fee-based personalization options

### 📊 **Comprehensive Analytics**
- Bundle performance tracking
- Sales conversion metrics
- Customer behavior insights
- Revenue optimization reports

### 💳 **Subscription Billing**
- **FREE**: Up to 6 products, basic features
- **PRO**: Unlimited products, advanced 3D effects, personalization
- Shopify-managed billing with seamless upgrades

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SHOPIFY ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│  Admin Panel (Embedded) │ Storefront (App Proxy) │ Webhooks │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BUNDLE APP SERVER                        │
├─────────────────────────────────────────────────────────────┤
│  Remix Routes │ Shared Utilities │ Theme Extension │ Database │
│  - Admin UI   │ - CORS Handling  │ - Liquid Files  │ - Prisma │
│  - API Proxy  │ - Image Utils    │ - CSS/JS Assets │ - SQLite │
│  - Billing    │ - Bundle Logic   │ - 3D Carousel   │ - Uploads│
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Shopify CLI 3.0+
- Shopify Partner account
- Development store

### Installation

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd bundleapp
   npm install
   ```

2. **Environment Setup**
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Configure required variables
   SHOPIFY_API_KEY=your_api_key
   SHOPIFY_API_SECRET=your_api_secret
   SHOPIFY_APP_URL=your_app_url
   SHOPIFY_SCOPES=read_products,write_products,read_themes,write_themes
   ```

3. **Database Setup**
   ```bash
   npm run setup
   ```

4. **Start Development**
   ```bash
   # With Shopify CLI (recommended)
   npm run dev
   
   # Or with tunnel
   npm run shopify:dev-fixed
   ```

## 📁 Project Structure

```
bundleapp/
├── app/                          # Remix application
│   ├── routes/                   # Route handlers
│   │   ├── app.*.jsx            # Admin interface routes
│   │   ├── apps.*.jsx           # Storefront API routes
│   │   └── api.*.jsx            # API endpoints
│   ├── utils/                    # Shared utilities
│   │   ├── cors.server.js       # CORS handling
│   │   ├── image.server.js      # Image processing
│   │   └── bundle.server.js     # Bundle operations
│   ├── billing/                  # Billing system
│   └── components/              # React components
├── extensions/bundle-builder/    # Theme app extension
│   ├── blocks/                  # Liquid templates
│   │   ├── bundle-builder.liquid
│   │   └── app-embed.liquid
│   ├── assets/                  # Frontend assets
│   │   ├── bundle.js            # Main JavaScript
│   │   ├── bundle.css           # Styling
│   │   └── enhanced-bundle-cards.css
│   └── locales/                 # Translations
├── prisma/                      # Database
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Migration files
└── public/uploads/             # User uploads
```

## 🔌 API Reference

### Admin Routes
- `GET /app` - Dashboard home
- `GET /app/bundles` - Bundle management
- `GET /app/bundle-manager/:id` - Edit bundle
- `GET /app/settings/billing` - Billing settings

### Storefront API
- `GET /apps/bundles` - List active bundles
- `GET /apps/bundles/:id` - Bundle details
- `POST /apps/bundles/:id` - Process purchase
- `GET /apps/bundles/uploads/:file` - Serve images

### Webhook Endpoints
- `POST /webhooks/app_subscriptions_update` - Billing updates
- `POST /webhooks/app_uninstalled` - Cleanup on uninstall

## 🛠️ Development

### Code Quality
```bash
# Linting
npm run lint

# Type checking
npm run type-check

# Testing
npm test
```

### Database Operations
```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Reset database
npx prisma migrate reset
```

### Deployment
```bash
# Deploy to Shopify
shopify app deploy

# Build for production
npm run build
```

## 🔧 Configuration

### Theme Extension Settings
- **3D Carousel**: Style, autoplay, speed configuration
- **Visual Effects**: Glassmorphism, parallax, haptic feedback
- **Accessibility**: Reduced motion, high contrast, keyboard navigation
- **Performance**: Image preloading, lazy loading options

### Admin Configuration
- **Shop Settings**: Plan management, widget preferences
- **Hero Customization**: Colors, titles, emojis
- **Language Support**: Multi-language text overrides
- **Analytics**: Tracking and reporting preferences

## 📊 Performance

- **Load Time**: < 2 seconds initial page load
- **3D Rendering**: 60fps smooth animations  
- **API Response**: < 500ms average response time
- **Mobile Optimized**: Touch-friendly interactions
- **Accessibility**: WCAG 2.1 AA compliance

## 🔒 Security

- **CORS Protection**: Configurable origin whitelist
- **Input Validation**: Comprehensive sanitization
- **Authentication**: Shopify App Bridge integration
- **Webhook Security**: HMAC signature verification
- **Data Encryption**: SSL/TLS for all communications

## 📚 Documentation

- **[Architecture Guide](./ARCHITECTURE.md)** - Detailed system architecture
- **[Project Overview](./PROJECT_OVERVIEW.md)** - Complete functionality guide
- **[API Documentation](./docs/api.md)** - Endpoint specifications
- **[Deployment Guide](./docs/deployment.md)** - Production deployment

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

Proprietary - Store Revive Project Use Only

## 🆘 Support

- **Documentation**: Check the docs folder for detailed guides
- **Issues**: Report bugs via GitHub issues
- **Contact**: Reach out to the development team

---

**Built with ❤️ for the Shopify ecosystem. Transform your store with Bundle App today!**


