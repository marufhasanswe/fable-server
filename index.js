const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGO_DB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized");
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).send("Unauthorized");
  }
};

const writerVerify = async (req, res, next) => {
  const user = req.user;
  if (user.role !== "writer") {
    return res.status(403).json({ msg: "Forbidden" });
  }
  next();
};

async function run() {
  try {
    await client.connect();
    const db = client.db("fable");
    const ebooksCollection = db.collection("ebooks");
    const purchasesCollection = db.collection("purchases");
    const bookmarksCollection = db.collection("bookmarks");
    const transactionsCollection = db.collection("transactions");

    // Ebook get api
    app.get("/api/books", async (req, res) => {
      const userId = req.query.userId;
      const query = {};
      if (userId) {
        query.writerId = userId;
      }
      const result = await ebooksCollection.find(query).toArray();
      res.send(result);
    });

    // Single ebook get api
    app.get("/api/books/:id", async (req, res) => {
      const { id } = req.params;
      const result = await ebooksCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Ebook add api
    app.post("/api/books", verifyToken, writerVerify, async (req, res) => {
      const data = req.body;
      const newEbook = {
        title: data.title,
        description: data.description,
        genre: data.genre,
        coverImage: data.coverImage,
        writerId: data.writerId,
        writerName: data.writerName,
        price: Number(data.price),
        status: "published",
        totalSales: 0,
        createdAt: new Date(),
      };
      const result = await ebooksCollection.insertOne(newEbook);
      res.send(result);
    });

    // Ebook update api
    app.patch("/api/books/:id", verifyToken, writerVerify, async (req, res) => {
      const id = req.params.id;
      const data = req.body;

      const update = {
        $set: {
          ...data,
          updatedAt: new Date(),
        },
      };

      const result = await ebooksCollection.updateOne(
        { _id: new ObjectId(id) },
        update,
      );

      res.send(result);
    });

    // Ebook delete api a
    app.delete(
      "/api/books/:id",
      verifyToken,
      writerVerify,
      async (req, res) => {
        const { id } = req.params;
        const result = await ebooksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      },
    );

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
