import Foundation

// The operator pages and the documents section (src/native/core/operators.ts; NATIVE.md "core.js
// API", Operators): the website's checks, bodies and texts.

/// PGF.operatorForm: the operator editor.
struct CoreOperatorForm: Decodable, Equatable, Sendable {
    struct Issue: Decodable, Equatable, Sendable {
        /// name, email, declarationsEmail or fplCopyEmail
        var field: String
        var message: String
    }
    struct Head: Decodable, Equatable, Sendable {
        struct Chip: Decodable, Equatable, Sendable {
            var text: String
            var title: String
        }
        /// The aircraft it operates, or "No aircraft".
        var subtitle: String
        var chip: Chip?
        var readOnly: Bool
        var canDelete: Bool
        /// "Shared by …" for a viewer.
        var viewOnly: String?
        var deleteTitle: String
        var deleteMessage: String
        var deleted: String
        var left: String
    }
    struct Person: Decodable, Equatable, Identifiable, Sendable {
        var key: String
        var name: String
        var email: String
        var isSelf: Bool
        var role: String
        var direct: Bool
        /// "Viewer · through SX-ASV"
        var label: String
        var id: String { key }

        enum CodingKeys: String, CodingKey {
            case key, name, email, role, direct, label
            case isSelf = "self"
        }
    }
    /// The editable fields (OperatorInput).
    var input: JSON
    var issues: [Issue]
    /// The body of PUT /api/operators/:id; nil while an issue holds it back.
    var body: JSON?
    var head: Head
    var people: [Person]?

    func issues(_ field: String) -> [FieldIssue] {
        issues.filter { $0.field == field }.map { FieldIssue(level: .error, message: $0.message) }
    }
}

/// PGF.operatorList: a row of the operators list.
struct CoreOperatorRow: Decodable, Equatable, Identifiable, Sendable {
    struct Flag: Decodable, Equatable, Sendable {
        var label: String
        var title: String
    }
    var id: String
    var name: String
    var chip: String?
    var through: String
    var aircraft: String
    var contact: String
    var flags: [Flag]
}

/// PGF.documents: an aircraft's or operator's documents.
struct CoreDocuments: Decodable, Equatable, Sendable {
    struct Row: Decodable, Equatable, Identifiable, Sendable {
        var id: String
        var title: String
        /// "manual.pdf · 3.0 MB · 2026-11-15"
        var detail: String
    }
    var rows: [Row]
    /// "Up to 80.0 MB"
    var hint: String
    var maxBytes: Int
    var chunkBytes: Int
    var pickError: String?
    /// The body of POST …/files for the picked file.
    var start: API.FileStart?
    var renamed: String?
}

extension Core {
    /// `operatorJSON`: GET /api/operators/:id; `draft`: the fields as edited; `people`: the sharing's
    /// people (JSON texts).
    func operatorForm(_ operatorJSON: String, draft: String? = nil, people: String? = nil, myId: String = "")
        throws -> CoreOperatorForm
    {
        try callDecoding(
            "operatorForm",
            fields: [
                "operator": operatorJSON, "draft": draft ?? "null", "people": people ?? "null",
                "myId": JSON.string(myId).text,
            ])
    }

    /// `operators`: GET /api/operators (JSON text).
    func operatorList(_ operators: String) throws -> [CoreOperatorRow] {
        struct Out: Decodable { var rows: [CoreOperatorRow] }
        return try callDecoding("operatorList", fields: ["operators": operators], as: Out.self).rows
    }

    /// The body of POST /api/operators for the typed name, or why not.
    func newOperator(name: String) throws -> (body: JSON?, error: String?) {
        let j = try callJSON("newOperator", fields: ["name": JSON.string(name).text])
        // JSON is nil-literal expressible: a bare nil here would be JSON null, not no value
        return (j["body"].flatMap { $0.isNull ? JSON?.none : $0 }, j["error"]?.string)
    }

    /// `documents`: GET …/files' documents (JSON text); `pick` a chosen file and `title` the title
    /// typed; `rename` a title as typed.
    func documents(
        _ documents: String = "[]", pick: (type: String, size: Int, name: String)? = nil, title: String = "",
        rename: (title: String, typed: String)? = nil
    ) throws -> CoreDocuments {
        var f = ["documents": documents, "title": JSON.string(title).text]
        if let pick {
            f["pick"] =
                JSON.object([
                    "type": .string(pick.type), "size": .number(Double(pick.size)), "name": .string(pick.name),
                ]).text
        }
        if let rename {
            f["rename"] = JSON.object(["title": .string(rename.title), "typed": .string(rename.typed)]).text
        }
        return try callDecoding("documents", fields: f)
    }
}
