import Foundation

/// The operators (Fixtures/operators.json, kept in memory as the server keeps them: POST adds, PUT
/// merges the fields, DELETE is the owner's) and their documents, uploaded chunk by chunk as on the
/// server (api/_lib/routes/{operators,files}.ts).
extension FixtureTransport {
    /// The fields PUT /operators/:id takes (src/shared/operators.ts OperatorInput).
    static let operatorFields = [
        "name", "phone", "email", "address", "aftn", "notes", "requiresWbPerf", "declarationsEmail",
        "requiresFplCopy", "fplCopyEmail",
    ]

    func operatorRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        let p = r.parts
        switch (r.method, r.first, r.count) {
        case ("GET", "operators", 1): return (200, nil, Self.encoded(.array(operators)))
        case ("POST", "operators", 1): return createOperator(r.body)
        case ("GET", "operators", 2):
            guard let o = operators.first(where: { $0["id"]?.string == p[1] }) else { return (404, nil, nil) }
            return (200, nil, Self.encoded(o))
        case ("PUT", "operators", 2): return updateOperator(p[1], r.body)
        case ("DELETE", "operators", 2):
            guard let i = operators.firstIndex(where: { $0["id"]?.string == p[1] }) else { return (404, nil, nil) }
            guard operators[i]["access"]?["role"]?.string == "owner" else {
                return (403, nil, try? JSON.object(["error": "Only the owner can delete the operator"]).data())
            }
            operators.remove(at: i)
            return (204, nil, Data())
        case (_, "operators", _) where p.count >= 3 && p[2] == "files": return fileRoute(r)
        default: return nil
        }
    }

    private func createOperator(_ body: Data?) -> (Int, String?, Data?) {
        guard let input = body.flatMap({ try? JSON.parse($0) }), let name = input["name"]?.string,
            !name.trimmingCharacters(in: .whitespaces).isEmpty
        else { return bad("name is required") }
        var o: JSON = [
            "id": .string("op-\(UUID().uuidString.prefix(8).lowercased())"), "aircraft": [],
            "access": [
                "role": "owner",
                "owner": [
                    "pilotId": pilot["id"] ?? "", "name": pilot["fullName"] ?? "", "email": pilot["email"] ?? "",
                ],
                "viaAircraft": [],
            ],
            "created": .number(Date().timeIntervalSince1970 * 1000),
        ]
        for k in Self.operatorFields { o[k] = input[k] ?? (k.hasPrefix("requires") ? false : "") }
        o["updated"] = o["created"]
        operators.append(o)
        return (201, nil, Self.encoded(o))
    }

    private func updateOperator(_ id: String, _ body: Data?) -> (Int, String?, Data?) {
        guard let i = operators.firstIndex(where: { $0["id"]?.string == id }) else { return (404, nil, nil) }
        guard operators[i]["access"]?["role"]?.string != "view" else {
            return (403, nil, try? JSON.object(["error": "You can view this operator, not change it"]).data())
        }
        let patch = body.flatMap { try? JSON.parse($0) } ?? [:]
        for k in Self.operatorFields { if let v = patch[k] { operators[i][k] = v } }
        operators[i]["updated"] = .number(Date().timeIntervalSince1970 * 1000)
        return (200, nil, Self.encoded(operators[i]))
    }

    /// GET …/files, POST (start), PUT …/:fileId/chunks/:seq, POST …/:fileId/complete, GET a chunk,
    /// PUT …/:fileId (title), DELETE …/:fileId.
    private func fileRoute(_ r: FixtureRequest) -> (Int, String?, Data?) {
        let p = r.parts
        let key = p[0...2].joined(separator: "/")
        let body = r.body.flatMap { try? JSON.parse($0) } ?? [:]
        func index(_ id: String) -> Int? { documents[key]?.firstIndex { $0["id"]?.string == id } }
        switch (r.method, p.count) {
        case ("GET", 3):
            let done = (documents[key] ?? []).filter { $0["complete"]?.bool == true }.map(Self.publicFile)
            return (200, nil, Self.encoded(["documents": .array(done)]))
        case ("POST", 3):
            let size = body["size"]?.int ?? 0
            // src/shared/types.ts AIRCRAFT_FILE_CHUNK_BYTES: the app uploads as many chunks as this says
            let chunkBytes = 2 * 1024 * 1024
            let f: JSON = [
                "id": .string("file-\(UUID().uuidString.prefix(8).lowercased())"), "kind": body["kind"] ?? "document",
                "title": body["title"] ?? "", "name": body["name"] ?? "", "mime": body["mime"] ?? "",
                "size": .number(Double(size)),
                "chunks": .number(Double(max(1, (size + chunkBytes - 1) / chunkBytes))),
                "uploaded": .number(Date().timeIntervalSince1970 * 1000), "complete": false,
            ]
            documents[key, default: []].append(f)
            return (201, nil, Self.encoded(Self.publicFile(f)))
        case ("PUT", 6) where p[4] == "chunks":
            chunks[p[3], default: [:]][Int(p[5]) ?? 0] = body["data"]?.string ?? ""
            return (204, nil, Data())
        case ("POST", 5) where p[4] == "complete":
            guard let i = index(p[3]) else { return (404, nil, nil) }
            documents[key]?[i]["complete"] = true
            return (200, nil, Self.encoded(Self.publicFile(documents[key]![i])))
        case ("GET", 6) where p[4] == "chunks":
            guard let data = chunks[p[3]]?[Int(p[5]) ?? 0] else { return (404, nil, nil) }
            return (200, nil, Self.encoded(["data": .string(data)]))
        case ("PUT", 4):
            guard let i = index(p[3]) else { return (404, nil, nil) }
            documents[key]?[i]["title"] = body["title"] ?? ""
            return (200, nil, Self.encoded(Self.publicFile(documents[key]![i])))
        case ("DELETE", 4):
            documents[key]?.removeAll { $0["id"]?.string == p[3] }
            chunks[p[3]] = nil
            return (204, nil, Data())
        default:
            return (404, nil, nil)
        }
    }

    /// The AircraftFile row as the server answers it (without the upload's state).
    private static func publicFile(_ f: JSON) -> JSON {
        guard case .object(var o) = f else { return f }
        o.removeValue(forKey: "complete")
        return .object(o)
    }
}
