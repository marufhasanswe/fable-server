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
  if (user.role === "writer" || user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ msg: "Forbidden" });
  }
};

async function run() {
  try {
    await client.connect();
    const db = client.db("fable");
    const ebooksCollection = db.collection("ebooks");
    const purchasesCollection = db.collection("purchases");
    const bookmarksCollection = db.collection("bookmarks");
    const transactionsCollection = db.collection("transactions");
    const usersCollection = db.collection("user");

    // Purchases get api
    app.get("/api/books/purchases/:userId", async (req, res) => {
      const { userId } = req.params;
      const result = await purchasesCollection
        .aggregate([
          {
            $match: {
              buyerId: userId,
            },
          },
          {
            $addFields: {
              ebookObjectId: {
                $toObjectId: "$ebookId",
              },
            },
          },

          {
            $lookup: {
              from: "ebooks",
              localField: "ebookObjectId",
              foreignField: "_id",
              as: "ebook",
            },
          },
          {
            $unwind: "$ebook",
          },
          {
            $project: {
              ebookId: 1,
              ebookTitle: 1,
              amount: 1,
              status: 1,
              writerName: 1,
              createdAt: 1,
              coverImage: "$ebook.coverImage",
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // Ebook get api
    app.get("/api/books", async (req, res) => {
      const { userId } = req.query;
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
      console.log(id);
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

    // Bookmarks ebook get api
    app.get("/api/books/bookmarks/:userId", async (req, res) => {
      const { userId } = req.params;

      const result = await bookmarksCollection
        .aggregate([
          {
            $match: {
              userId: userId,
            },
          },

          {
            $addFields: {
              ebookObjectId: {
                $toObjectId: "$ebookId",
              },
            },
          },

          {
            $lookup: {
              from: "ebooks",
              localField: "ebookObjectId",
              foreignField: "_id",
              as: "ebook",
            },
          },

          {
            $unwind: "$ebook",
          },

          {
            $project: {
              _id: 1,
              createdAt: 1,

              ebookId: 1,

              title: "$ebook.title",
              coverImage: "$ebook.coverImage",
              writerName: "$ebook.writerName",
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // Bookmark add api
    app.post("/api/books/bookmarks", verifyToken, async (req, res) => {
      const data = req.body;
      const userId = req.user.id;
      const newBookmark = {
        ebookId: data.ebookId,
        userId: userId,
        createdAt: new Date(),
      };
      const isExist = await bookmarksCollection.findOne({
        ebookId: data.ebookId,
        userId: userId,
      });
      if (isExist) {
        return res.status(400).json({ msg: "Already bookmarked" });
      }
      const result = await bookmarksCollection.insertOne(newBookmark);
      res.send(result);
    });

    // Bookmark delete api
    app.delete("/api/books/bookmarks/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const userId = req.user.id;
      const result = await bookmarksCollection.deleteOne({
        _id: new ObjectId(id),
        userId: userId,
      });
      res.send(result);
    });

    // purchase check api
    app.get("/api/purchase/check/:ebookId", verifyToken, async (req, res) => {
      const { ebookId } = req.params;
      const userId = req.user.id;
      const exist = await purchasesCollection.findOne({
        ebookId: ebookId,
        buyerId: userId,
      });
      return res.json({ purchased: exist });
    });

    // purchase history get api
    app.get("/api/purchases/history/:userId", async (req, res) => {
      const { userId } = req.params;
      const query = {};
      if (userId) {
        query.buyerId = userId;
      }
      const result = await purchasesCollection.find(query).toArray();
      res.send(result);
    });

    // purchases add api
    app.post("/api/books/purchases", verifyToken, async (req, res) => {
      const data = req.body;
      const newPurchase = {
        ebookId: data.ebookId,
        ebookTitle: data.ebookTitle,
        buyerId: data.buyerId,
        buyerEmail: data.buyerEmail,
        writerId: data.writerId,
        writerName: data.writerName,
        status: "completed",
        amount: Number(data.amount),
        stripeSessionId: data.session_id,
        createdAt: new Date(),
      };
      const isExist = await purchasesCollection.findOne({
        stripeSessionId: data.session_id,
      });
      if (isExist) {
        return res.status(400).json({ msg: "Already purchased" });
      }
      const result = await purchasesCollection.insertOne(newPurchase);

      await ebooksCollection.updateOne(
        { _id: new ObjectId(data.ebookId) },
        {
          $inc: {
            totalSales: 1,
          },
        },
      );

      // transactions history
      const newTransaction = {
        type: "purchase",
        amount: Number(data.amount),
        userId: data.buyerId,
        userEmail: data.buyerEmail,
        stripeSessionId: data.session_id,
        status: "completed",
        writerId: data.writerId,
        createdAt: new Date(),
      };
      await transactionsCollection.insertOne(newTransaction);

      return res.json({ msg: "Purchased successfully", ok: true });
    });

    // Sales history get api
    app.get("/api/sales/history/:userId", async (req, res) => {
      const { userId } = req.params;

      const result = await purchasesCollection
        .aggregate([
          {
            $match: {
              writerId: userId,
            },
          },
          {
            $addFields: {
              buyerObjectId: {
                $toObjectId: "$buyerId",
              },
            },
          },

          {
            $lookup: {
              from: "user",
              localField: "buyerObjectId",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: "$user",
          },
          { $sort: { createdAt: -1 } },
          {
            $project: {
              ebookTitle: 1,
              amount: 1,
              createdAt: 1,
              buyerName: "$user.name",
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // Admin dashboard stats api

    app.get("/api/admin/dashboard", async (req, res) => {
      try {
        /*
    ==========================
    USERS
    ==========================
    */

        const totalUsers = await usersCollection.countDocuments({
          role: "user",
        });

        const totalWriters = await usersCollection.countDocuments({
          role: "writer",
        });

        /*
    ==========================
    SALES + REVENUE
    ==========================
    */

        const salesResult = await purchasesCollection
          .aggregate([
            {
              $match: {
                status: "completed",
              },
            },

            {
              $group: {
                _id: null,

                totalSales: {
                  $sum: 1,
                },

                revenue: {
                  $sum: "$amount",
                },
              },
            },
          ])
          .toArray();

        const totalSales = salesResult[0]?.totalSales || 0;

        const revenue = salesResult[0]?.revenue || 0;

        /*
    ==========================
    MONTHLY SALES CHART
    ==========================
    */

        const monthlySales = await purchasesCollection
          .aggregate([
            {
              $match: {
                status: "completed",
              },
            },

            {
              $group: {
                _id: {
                  month: {
                    $month: "$createdAt",
                  },
                },

                sales: {
                  $sum: "$amount",
                },
              },
            },

            {
              $sort: {
                "_id.month": 1,
              },
            },
          ])
          .toArray();

        const monthNames = [
          "",
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];

        const monthlySalesChart = monthlySales.map((item) => ({
          month: monthNames[item._id.month],

          sales: item.sales,
        }));

        /*
    ==========================
    EBOOK GENRE PIE CHART
    ==========================
    */

        const genreData = await ebooksCollection
          .aggregate([
            {
              $match: {
                status: "published",
              },
            },

            {
              $group: {
                _id: "$genre",

                count: {
                  $sum: 1,
                },
              },
            },
          ])
          .toArray();

        const ebooksByGenre = genreData.map((item) => ({
          name: item._id,

          value: item.count,
        }));

        res.send({
          success: true,

          stats: {
            totalUsers,

            totalWriters,

            totalSales,

            revenue,
          },

          charts: {
            monthlySales: monthlySalesChart,

            ebooksByGenre,
          },
        });
      } catch (error) {
        console.log(error);

        res.status(500).send({
          success: false,

          message: "Dashboard data error",
        });
      }
    });

    //Get all Transactions
    app.get("/api/transactions", async (req, res) => {
      const result = await transactionsCollection.find({}).toArray();
      res.send(result);
    });

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
