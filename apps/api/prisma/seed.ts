import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

const products = [
  { name: "Potato Chips", pricePaise: 2000, stock: 10 },
  { name: "Chocolate Bar", pricePaise: 1500, stock: 8 },
  { name: "Cookies", pricePaise: 2500, stock: 6 },
  { name: "Orange Juice", pricePaise: 3000, stock: 5 },
  { name: "Mineral Water", pricePaise: 1000, stock: 12 },
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: {
        pricePaise: product.pricePaise,
        stock: product.stock,
      },
      create: product,
    });
  }

  console.log(`Seeded ${products.length} products.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed products:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });