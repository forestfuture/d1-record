# Only the explicit Database is supported

Records reach D1 only through a **Database** created at the request edge (`const db = connect(env.DB)`, then `db.model(User)`). The brief also allowed `User.using(env.DB)`, but we don't offer it, even as sugar. Having one way to connect guarantees that no binding or session is ever stored on a Model class, where it could leak between concurrent requests in one isolate. It also gives `batch()` and session routing one owner.
