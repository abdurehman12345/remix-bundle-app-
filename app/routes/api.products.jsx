import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getHiddenHandlesForShop } from "../utils/hidden.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const collection = url.searchParams.get("collection") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  // Get shop domain for hidden product filtering
  const shop = url.searchParams.get("shop") || null;
  let hiddenHandles = new Set();
  if (shop) {
    try {
      const session = await prisma.session.findFirst({ 
        where: { shop }, 
        orderBy: { expires: 'desc' } 
      });
      if (session?.accessToken) {
        hiddenHandles = await getHiddenHandlesForShop(shop, session.accessToken);
      }
    } catch (error) {
      console.log('Failed to get hidden handles:', error.message);
    }
  }

  try {
    let resp;
    if (collection) {
      // Get products from specific collection
      resp = await admin.graphql(`#graphql
        query CollectionProducts($id: ID!, $first: Int!) {
          collection(id: $id) {
            products(first: $first) {
              nodes {
                id
                title
                featuredMedia { preview { image { url } } }
                variants(first: 1) {
                  nodes {
                    id
                    title
                    price
                    image { url }
                  }
                }
              }
            }
          }
        }
      `, { variables: { id: collection, first: limit } });
      
      const data = await resp.json();
      const products = data?.data?.collection?.products?.nodes || [];
      
      // Filter out hidden products server-side
      const visibleProducts = products.filter(p => {
        try {
          // Extract handle from product ID (format: gid://shopify/Product/123456789)
          const handle = p.id.split('/').pop();
          return !hiddenHandles.has(handle);
        } catch (_) {
          return true; // If we can't determine handle, include the product
        }
      });

      return json({
        products: visibleProducts.map(p => ({
          id: p.id,
          title: p.title,
          imageUrl: p.featuredMedia?.preview?.image?.url,
          variant: p.variants?.nodes?.[0] ? {
            id: p.variants.nodes[0].id,
            title: p.variants.nodes[0].title,
            price: p.variants.nodes[0].price,
            imageUrl: p.variants.nodes[0].image?.url
          } : null
        }))
      });
    } else if (query.trim()) {
      // Search by query
      resp = await admin.graphql(`#graphql
        query SearchProducts($query: String!, $first: Int!) {
          products(query: $query, first: $first) {
            nodes {
              id
              title
              featuredMedia { preview { image { url } } }
              variants(first: 1) {
                nodes {
                  id
                  title
                  price
                  image { url }
                }
              }
            }
          }
        }
      `, { variables: { query, first: limit } });
    } else {
      // Browse first N products (no pagination for simplicity/stability)
      resp = await admin.graphql(`#graphql
        query AllProducts($first: Int!) {
          products(first: $first) {
            nodes {
              id
              title
              featuredMedia { preview { image { url } } }
              variants(first: 1) {
                nodes {
                  id
                  title
                  price
                  image { url }
                }
              }
            }
          }
        }
      `, { variables: { first: limit } });
    }

    const data = await resp.json();
    const products = data?.data?.products?.nodes || [];

    // Filter out hidden products server-side
    const visibleProducts = products.filter(p => {
      try {
        // Extract handle from product ID (format: gid://shopify/Product/123456789)
        const handle = p.id.split('/').pop();
        return !hiddenHandles.has(handle);
      } catch (_) {
        return true; // If we can't determine handle, include the product
      }
    });

    return json({
      products: visibleProducts.map(p => ({
        id: p.id,
        title: p.title,
        imageUrl: p.featuredMedia?.preview?.image?.url,
        variant: p.variants?.nodes?.[0] ? {
          id: p.variants.nodes[0].id,
          title: p.variants.nodes[0].title,
          price: p.variants.nodes[0].price,
          imageUrl: p.variants.nodes[0].image?.url
        } : null
      }))
    });
  } catch (error) {
    console.error("Product search error:", error);
    return json({ error: "Failed to search products" }, { status: 500 });
  }
};
