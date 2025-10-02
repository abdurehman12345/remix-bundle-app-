# Bundle App - Architecture Documentation

## 📋 Table of Contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Components](#core-components)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Frontend Components](#frontend-components)
- [Billing System](#billing-system)
- [Security & CORS](#security--cors)
- [Performance Optimizations](#performance-optimizations)
- [Development Workflow](#development-workflow)

## 🎯 Overview

The Bundle App is a sophisticated Shopify application that enables merchants to create, manage, and sell product bundles with advanced features including:

- **3D Ring Carousel**: Modern, interactive product presentation
- **Flexible Bundle Types**: Fixed, Mix & Match, and Build-a-Box bundles
- **Advanced Pricing**: Fixed pricing, percentage discounts, tiered pricing
- **Personalization**: Custom messages, gift wrapping, card selection
- **Subscription Billing**: Free and Pro tiers with Shopify-managed billing
- **Admin Dashboard**: Complete bundle management interface
- **Storefront Integration**: Theme app extension for seamless customer experience

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SHOPIFY ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Admin Panel   │  │   Storefront    │  │  Webhooks   │  │
│  │   (Embedded)    │  │  (App Proxy)    │  │   System    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BUNDLE APP SERVER                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  Remix Routes   │  │   Utilities     │  │  Extensions │  │
│  │  - Admin UI     │  │  - CORS         │  │  - Liquid   │  │
│  │  - API Proxy    │  │  - Images       │  │  - CSS/JS   │  │
│  │  - Billing      │  │  - Bundles      │  │  - Assets   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
│                              │                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Database      │  │   File Storage  │  │  Billing    │  │
│  │   (Prisma)      │  │   (Uploads)     │  │  (GraphQL)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 🧩 Core Components

### 1. **Admin Interface** (`/app` routes)
- **Bundle Management**: Create, edit, delete bundles
- **Product Selection**: Choose products from Shopify collections
- **Pricing Configuration**: Set pricing rules and discounts
- **Wrapping & Cards**: Manage gift options
- **Analytics**: View bundle performance metrics
- **Settings**: Configure shop preferences and billing

### 2. **Storefront Integration** (`/apps` routes)
- **App Proxy**: Serves bundle data to storefront
- **3D Carousel**: Interactive product presentation
- **Bundle Builder**: Customer-facing bundle creation interface
- **Cart Integration**: Seamless add-to-cart functionality
- **Image Serving**: Optimized image delivery

### 3. **Theme App Extension**
- **Liquid Templates**: `bundle-builder.liquid`, `app-embed.liquid`
- **JavaScript**: Enhanced 3D carousel with modern effects
- **CSS**: Responsive, accessible styling system
- **Configuration**: Rich admin customization options

### 4. **Billing System**
- **Subscription Management**: Free and Pro tiers
- **Shopify Integration**: Native billing API
- **Feature Gating**: Plan-based functionality restrictions
- **Webhook Handling**: Real-time subscription updates

## 🗄️ Database Schema

### Core Models

#### **Bundle**
```prisma
model Bundle {
  id               String         @id @default(cuid())
  bundleId         String?        @unique // Public storefront ID
  shop             String
  title            String
  description      String?
  imageUrl         String?
  collectionId     String?        // Shopify Collection GID
  pricingType      PricingType    @default(SUM)
  priceValueCents  Int?
  minItems         Int?
  maxItems         Int?
  startAt          DateTime?      // Schedule publishing
  endAt            DateTime?
  allowMessage     Boolean        @default(false)
  allowCardUpload  Boolean        @default(false)
  messageCharLimit Int?
  personalizationFeeCents Int?
  wrapRequired     Boolean        @default(false)
  status           BundleStatus   @default(DRAFT)
  type             BundleType     @default(FIXED)
  
  // Relations
  products         BundleProduct[]
  wrappingOptions  WrappingOption[]
  cards            BundleCard[]
  tierPrices       BundleTierPrice[]
}
```

#### **BundleProduct**
```prisma
model BundleProduct {
  id           String  @id @default(cuid())
  bundleId     String
  productGid   String  // Shopify Product GID
  variantGid   String? // Default variant
  variantTitle String?
  imageUrl     String?
  priceCents   Int?
  min          Int     @default(0)
  max          Int     @default(0)
  variantsJson String? // JSON array of variant data
}
```

#### **ShopSettings**
```prisma
model ShopSettings {
  shop                 String   @id
  plan                 PlanType @default(FREE)
  widgetEnabled        Boolean  @default(true)
  languageJson         String?  // i18n overrides
  widgetPagesJson      String?  // Enabled pages
  heroEnabled          Boolean? @default(true)
  heroTitle            String?
  heroSubtitle         String?
  heroEmoji            String?
  heroColorStart       String?
  heroColorEnd         String?
}
```

### Supporting Models
- **WrappingOption**: Gift wrap configurations
- **BundleCard**: Greeting card templates
- **BundleTierPrice**: Volume pricing tiers
- **BundleSale**: Analytics tracking
- **ShopSubscription**: Billing state
- **SupportMessage**: Customer support system

## 🔌 API Endpoints

### Admin Routes (`/app/*`)
- `GET /app` - Dashboard home
- `GET /app/bundles` - Bundle listing and creation
- `GET /app/bundle-manager` - Advanced bundle management
- `GET/POST /app/bundle-manager/:id` - Edit specific bundle
- `GET /app/settings/billing` - Billing management
- `GET /app/pricing` - Pricing page
- `GET /app/support` - Support interface

### App Proxy Routes (`/apps/*`)
- `GET /apps/bundles` - List all active bundles
- `GET /apps/bundles/:id` - Get bundle details with products
- `POST /apps/bundles/:id` - Process bundle purchase
- `GET /apps/bundles/uploads/:file` - Serve uploaded images
- `GET /apps/hero` - Hero section data
- `POST /apps/bundles/carousel` - Carousel preferences

### API Routes (`/api/*`)
- `GET/POST /api/bundles/:id` - Bundle CRUD operations
- `POST /api/edit-theme` - Theme customization
- `GET /api/products` - Product search and selection

### Webhook Routes (`/webhooks/*`)
- `POST /webhooks/app_subscriptions_update` - Billing updates
- `POST /webhooks/app_uninstalled` - App uninstall cleanup

## 🎨 Frontend Components

### 3D Ring Carousel
- **Technology**: Vanilla JavaScript with CSS3 transforms
- **Features**: 
  - Multiple carousel styles (Coverflow, Cube, Flip, Slide)
  - 3D ring formation with configurable radius and tilt
  - Autoplay with customizable speed
  - Touch/swipe gesture support
  - Keyboard navigation
  - Accessibility compliance (ARIA labels, screen reader support)
  - Performance optimizations (Intersection Observer, debounced events)

### Bundle Builder Interface
- **Product Selection**: Interactive product grid with variant dropdowns
- **Price Calculation**: Real-time pricing updates
- **Customization Options**: Gift wrapping, cards, personalized messages
- **Responsive Design**: Mobile-first approach
- **Error Handling**: Graceful fallbacks and user feedback

### Admin Dashboard
- **Polaris Design System**: Consistent Shopify admin experience
- **Form Validation**: Real-time validation with error handling
- **Image Upload**: Drag-and-drop file upload with preview
- **Rich Text Editor**: Bundle description formatting
- **Data Tables**: Sortable, filterable bundle listings

## 💳 Billing System

### Architecture
```
Shopify Billing API ←→ Bundle App ←→ Feature Gates
                         ↓
                   Database Storage
                         ↓
                   Webhook Updates
```

### Plans
- **FREE**: 
  - Up to 6 products per bundle
  - Basic carousel styles
  - No gift wrapping/cards
  - No personalization

- **PRO**: 
  - Unlimited products
  - Advanced 3D carousel styles
  - Gift wrapping and cards
  - Personalized messages
  - Priority support

### Implementation
- **Subscription Creation**: `createOrReplaceSubscription()` function
- **Status Checking**: Cached billing status with 60s TTL
- **Feature Gating**: Runtime plan validation
- **Webhook Handling**: Real-time subscription status updates

## 🔒 Security & CORS

### CORS Configuration
- **Allowed Origins**: Configurable whitelist
- **Credentials**: Support for authenticated requests
- **Methods**: GET, POST, OPTIONS
- **Headers**: Content-Type, Authorization, X-Shopify-Shop-Domain

### Authentication
- **Admin Routes**: Shopify app authentication required
- **App Proxy**: Shopify app proxy validation
- **API Routes**: Session-based authentication
- **Webhooks**: HMAC signature verification

### Data Validation
- **Input Sanitization**: All user inputs validated
- **SQL Injection**: Prisma ORM prevents SQL injection
- **XSS Protection**: Content Security Policy headers
- **Rate Limiting**: Shopify-managed rate limiting

## ⚡ Performance Optimizations

### Database
- **Query Optimization**: Selective field loading with Prisma
- **Indexing**: Proper database indexes on frequently queried fields
- **Connection Pooling**: Efficient database connection management
- **Caching**: Billing status caching, image URL normalization

### Frontend
- **Code Splitting**: Lazy loading of non-critical components
- **Image Optimization**: Responsive images with srcset
- **CSS Optimization**: Critical CSS inlining
- **JavaScript**: Debounced event handlers, Intersection Observer

### API
- **Response Caching**: Appropriate cache headers
- **Compression**: Gzip compression for responses
- **CDN Integration**: Static asset delivery via CDN
- **Bundle Optimization**: Webpack/Vite optimizations

## 🔄 Development Workflow

### Local Development
```bash
# Install dependencies
npm install

# Set up database
npm run setup

# Start development server
npm run dev

# Alternative: Start with tunnel
npm run shopify:dev-fixed
```

### Code Quality
- **ESLint**: Code linting with Shopify config
- **Prettier**: Consistent code formatting
- **TypeScript**: Type safety where applicable
- **Testing**: Unit tests for critical functions

### Deployment
- **Shopify CLI**: `shopify app deploy`
- **Environment Variables**: Secure configuration management
- **Database Migrations**: Automatic schema updates
- **Asset Compilation**: Optimized bundle generation

### Monitoring
- **Error Logging**: Comprehensive error tracking
- **Performance Metrics**: Load time monitoring
- **Analytics**: Bundle usage and conversion tracking
- **Health Checks**: System status monitoring

## 📚 Additional Resources

- **Shopify App Development**: [https://shopify.dev/docs/apps](https://shopify.dev/docs/apps)
- **Remix Framework**: [https://remix.run/docs](https://remix.run/docs)
- **Prisma ORM**: [https://www.prisma.io/docs](https://www.prisma.io/docs)
- **Shopify Polaris**: [https://polaris.shopify.com](https://polaris.shopify.com)

---

*This documentation is maintained alongside the codebase. For questions or updates, please refer to the development team.*
