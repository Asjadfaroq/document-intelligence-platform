using DocumentIntelligence.Domain;
using MediatR;

namespace DocumentIntelligence.Application;

public record RegisterTenantAndOwnerCommand(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword
) : IRequest<AuthResult>;

public record LoginCommand(
    string Email,
    string Password,
    string TenantSlug
) : IRequest<AuthResult>;

public record AuthResult(
    string AccessToken,
    string TenantId,
    string Email,
    string Role
);

public record WorkspaceDto(
    Guid Id,
    string Name,
    string? Description,
    DateTime CreatedAt
);

public record DocumentDto(
    Guid Id,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language,
    DocumentStatus Status,
    DateTime CreatedAt
);

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface IJwtTokenGenerator
{
    string GenerateToken(User user);
}

public interface IStorageService
{
    Task<string> UploadDocumentAsync(
        Guid tenantId,
        Guid workspaceId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken);
}

public interface IEmbeddingService
{
    Task<float[]> GetEmbeddingAsync(string text, CancellationToken cancellationToken);
}

public interface ILLMClient
{
    Task<string> GenerateAnswerAsync(string question, string context, CancellationToken cancellationToken);
}

public record DocumentIngestionMessage(Guid DocumentId, Guid TenantId);

public interface IIngestionQueue
{
    Task EnqueueAsync(DocumentIngestionMessage message, CancellationToken cancellationToken);
}
public interface IApplicationDbContext
{
    IQueryable<Tenant> Tenants { get; }
    IQueryable<User> Users { get; }
    IQueryable<Workspace> Workspaces { get; }
    IQueryable<Document> Documents { get; }

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken);
}

public record GetWorkspacesQuery(Guid TenantId) : IRequest<IReadOnlyList<WorkspaceDto>>;

public record CreateWorkspaceCommand(Guid TenantId, string Name, string? Description) : IRequest<WorkspaceDto>;

public record GetDocumentsQuery(Guid TenantId, Guid WorkspaceId) : IRequest<IReadOnlyList<DocumentDto>>;

public record CreateDocumentCommand(
    Guid TenantId,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language
) : IRequest<DocumentDto>;

public record UploadDocumentCommand(
    Guid TenantId,
    Guid WorkspaceId,
    string FileName,
    Stream Content,
    string? Language
) : IRequest<DocumentDto>;

public record AskRequest(
    Guid WorkspaceId,
    string Question,
    int TopK
);

public record AskResponse(
    string Answer,
    IReadOnlyList<DocumentDto> Sources
);

public record AskQuestionCommand(
    Guid TenantId,
    Guid WorkspaceId,
    Guid UserId,
    string Question,
    int TopK
) : IRequest<AskResponse>;

public record RetrievalChunkDto(Guid ChunkId, string Content, Guid DocumentId, string FileName);

public interface IVectorSearchService
{
    Task<IReadOnlyList<RetrievalChunkDto>> SearchChunksAsync(
        Guid tenantId,
        Guid workspaceId,
        float[] queryEmbedding,
        int topK,
        CancellationToken cancellationToken);
}

public class RegisterTenantAndOwnerCommandHandler : IRequestHandler<RegisterTenantAndOwnerCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;

    public RegisterTenantAndOwnerCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
    }

    public async Task<AuthResult> Handle(RegisterTenantAndOwnerCommand request, CancellationToken cancellationToken)
    {
        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = request.TenantName,
            Slug = request.TenantSlug,
            CreatedAt = DateTime.UtcNow
        };

        var owner = new User
        {
            Id = Guid.NewGuid(),
            Email = request.OwnerEmail.ToLowerInvariant(),
            PasswordHash = _passwordHasher.Hash(request.OwnerPassword),
            Role = UserRole.Owner,
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        var defaultWorkspace = new Workspace
        {
            Id = Guid.NewGuid(),
            Name = "Default",
            Description = "Default workspace",
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(tenant, cancellationToken);
        await _db.AddAsync(owner, cancellationToken);
        await _db.AddAsync(defaultWorkspace, cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);

        var token = _jwt.GenerateToken(owner);

        return new AuthResult(
            token,
            tenant.Id.ToString(),
            owner.Email,
            owner.Role.ToString());
    }
}

public class LoginCommandHandler : IRequestHandler<LoginCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;

    public LoginCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
    }

    public async Task<AuthResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var tenant = _db.Tenants.FirstOrDefault(t => t.Slug == request.TenantSlug);
        if (tenant is null)
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        var email = request.Email.ToLowerInvariant();
        var user = _db.Users.FirstOrDefault(u => u.TenantId == tenant.Id && u.Email == email);
        if (user is null)
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        if (!_passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        var token = _jwt.GenerateToken(user);

        return new AuthResult(
            token,
            tenant.Id.ToString(),
            user.Email,
            user.Role.ToString());
    }
}

public class GetWorkspacesQueryHandler : IRequestHandler<GetWorkspacesQuery, IReadOnlyList<WorkspaceDto>>
{
    private readonly IApplicationDbContext _db;

    public GetWorkspacesQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<WorkspaceDto>> Handle(GetWorkspacesQuery request, CancellationToken cancellationToken)
    {
        var workspaces = _db.Workspaces
            .Where(w => w.TenantId == request.TenantId)
            .OrderBy(w => w.CreatedAt)
            .Select(w => new WorkspaceDto(w.Id, w.Name, w.Description, w.CreatedAt))
            .ToList()
            .AsReadOnly();

        return Task.FromResult<IReadOnlyList<WorkspaceDto>>(workspaces);
    }
}

public class CreateWorkspaceCommandHandler : IRequestHandler<CreateWorkspaceCommand, WorkspaceDto>
{
    private readonly IApplicationDbContext _db;

    public CreateWorkspaceCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<WorkspaceDto> Handle(CreateWorkspaceCommand request, CancellationToken cancellationToken)
    {
        var workspace = new Workspace
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            Name = request.Name,
            Description = request.Description,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(workspace, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new WorkspaceDto(workspace.Id, workspace.Name, workspace.Description, workspace.CreatedAt);
    }
}

public class GetDocumentsQueryHandler : IRequestHandler<GetDocumentsQuery, IReadOnlyList<DocumentDto>>
{
    private readonly IApplicationDbContext _db;

    public GetDocumentsQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<DocumentDto>> Handle(GetDocumentsQuery request, CancellationToken cancellationToken)
    {
        var docs = _db.Documents
            .Where(d => d.TenantId == request.TenantId && d.WorkspaceId == request.WorkspaceId)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new DocumentDto(
                d.Id,
                d.WorkspaceId,
                d.FileName,
                d.StoragePath,
                d.Language,
                d.Status,
                d.CreatedAt))
            .ToList()
            .AsReadOnly();

        return Task.FromResult<IReadOnlyList<DocumentDto>>(docs);
    }
}

public class CreateDocumentCommandHandler : IRequestHandler<CreateDocumentCommand, DocumentDto>
{
    private readonly IApplicationDbContext _db;

    public CreateDocumentCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<DocumentDto> Handle(CreateDocumentCommand request, CancellationToken cancellationToken)
    {
        var document = new Document
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            FileName = request.FileName,
            StoragePath = request.StoragePath,
            Language = request.Language,
            Status = DocumentStatus.Uploaded,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(document, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new DocumentDto(
            document.Id,
            document.WorkspaceId,
            document.FileName,
            document.StoragePath,
            document.Language,
            document.Status,
            document.CreatedAt);
    }
}

public class UploadDocumentCommandHandler : IRequestHandler<UploadDocumentCommand, DocumentDto>
{
    private readonly IApplicationDbContext _db;
    private readonly IStorageService _storage;
    private readonly IIngestionQueue _queue;

    public UploadDocumentCommandHandler(
        IApplicationDbContext db,
        IStorageService storage,
        IIngestionQueue queue)
    {
        _db = db;
        _storage = storage;
        _queue = queue;
    }

    public async Task<DocumentDto> Handle(UploadDocumentCommand request, CancellationToken cancellationToken)
    {
        var storagePath = await _storage.UploadDocumentAsync(
            request.TenantId,
            request.WorkspaceId,
            request.FileName,
            request.Content,
            cancellationToken);

        var document = new Document
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            FileName = request.FileName,
            StoragePath = storagePath,
            Language = request.Language,
            Status = DocumentStatus.Uploaded,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(document, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        await _queue.EnqueueAsync(new DocumentIngestionMessage(document.Id, document.TenantId), cancellationToken);

        return new DocumentDto(
            document.Id,
            document.WorkspaceId,
            document.FileName,
            document.StoragePath,
            document.Language,
            document.Status,
            document.CreatedAt);
    }
}

public class AskQuestionCommandHandler : IRequestHandler<AskQuestionCommand, AskResponse>
{
    private readonly IApplicationDbContext _db;
    private readonly IEmbeddingService _embeddings;
    private readonly ILLMClient _llm;
    private readonly IVectorSearchService _vectorSearch;

    public AskQuestionCommandHandler(
        IApplicationDbContext db,
        IEmbeddingService embeddings,
        ILLMClient llm,
        IVectorSearchService vectorSearch)
    {
        _db = db;
        _embeddings = embeddings;
        _llm = llm;
        _vectorSearch = vectorSearch;
    }

    public async Task<AskResponse> Handle(AskQuestionCommand request, CancellationToken cancellationToken)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var questionEmbedding = await _embeddings.GetEmbeddingAsync(request.Question, cancellationToken);

        var topK = request.TopK <= 0 ? 5 : Math.Min(request.TopK, 10);
        var chunks = await _vectorSearch.SearchChunksAsync(
            request.TenantId,
            request.WorkspaceId,
            questionEmbedding,
            topK,
            cancellationToken);

        var contextText = chunks.Count > 0
            ? string.Join("\n\n---\n\n", chunks.Select(c => $"[{c.FileName}]\n{c.Content}"))
            : "No relevant documents found.";

        var answerText = await _llm.GenerateAnswerAsync(request.Question, contextText, cancellationToken);
        sw.Stop();

        var documentIds = chunks.Select(c => c.DocumentId).Distinct().ToList();
        var docs = _db.Documents
            .Where(d => documentIds.Contains(d.Id))
            .Select(d => new DocumentDto(
                d.Id,
                d.WorkspaceId,
                d.FileName,
                d.StoragePath,
                d.Language,
                d.Status,
                d.CreatedAt))
            .ToList()
            .AsReadOnly();

        var question = new Question
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            UserId = request.UserId,
            QuestionText = request.Question,
            CreatedAt = DateTime.UtcNow
        };
        await _db.AddAsync(question, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        var answer = new Answer
        {
            Id = Guid.NewGuid(),
            QuestionId = question.Id,
            AnswerText = answerText,
            SourcesJson = System.Text.Json.JsonSerializer.Serialize(chunks.Select(c => new { c.ChunkId, c.DocumentId, c.FileName }).ToList()),
            LatencyMs = (int)sw.ElapsedMilliseconds,
            ModelName = null
        };
        await _db.AddAsync(answer, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new AskResponse(answerText, docs);
    }
}
