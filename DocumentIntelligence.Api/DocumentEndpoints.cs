using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public record CreateDocumentRequest(
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language);
public record UploadDocumentResponse(DocumentDto Document);

public static class DocumentEndpoints
{
    public static IEndpointRouteBuilder MapDocuments(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/documents")
            .RequireAuthorization("TenantUser");

        group.MapGet("/workspaces/{workspaceId:guid}", async (
            Guid workspaceId,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceId, tenantId.Value, ct))
            {
                return Results.Forbid();
            }

            var result = await mediator.Send(new GetDocumentsQuery(tenantId.Value, workspaceId), ct);
            return Results.Ok(result);
        });

        group.MapPost(string.Empty, async (
            CreateDocumentRequest request,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(request.WorkspaceId, tenantId.Value, ct))
            {
                return Results.Forbid();
            }

            var command = new CreateDocumentCommand(
                tenantId.Value,
                request.WorkspaceId,
                request.FileName,
                request.StoragePath,
                request.Language);

            var created = await mediator.Send(command, ct);
            return Results.Ok(created);
        });

        group.MapPost("/upload", async (
            string workspaceId,
            IFormFile file,
            string? language,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("DocumentIntelligence.Documents");
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            if (!Guid.TryParse(workspaceId, out var workspaceGuid))
            {
                return Results.BadRequest("workspaceId must be a valid GUID.");
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceGuid, tenantId.Value, ct))
            {
                return Results.Forbid();
            }

            if (file == null || file.Length == 0)
            {
                return Results.BadRequest("File is required.");
            }

            var ext = Path.GetExtension(file.FileName).TrimStart('.');
            if (string.IsNullOrEmpty(ext) || !ext.Equals("pdf", StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest("Only PDF documents are supported. Please upload a PDF file.");
            }

            await using var stream = file.OpenReadStream();

            var command = new UploadDocumentCommand(
                tenantId.Value,
                workspaceGuid,
                file.FileName,
                stream,
                language);

            try
            {
                var document = await mediator.Send(command, ct);
                log.LogInformation(
                    "Document uploaded and enqueued: DocumentId={DocumentId}, WorkspaceId={WorkspaceId}, FileName={FileName}, TenantId={TenantId}",
                    document.Id, workspaceGuid, file.FileName, tenantId.Value);
                return Results.Ok(new UploadDocumentResponse(document));
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Document upload failed: FileName={FileName}, WorkspaceId={WorkspaceId}", file.FileName, workspaceGuid);
                throw;
            }
        })
        .DisableAntiforgery()
        .Accepts<IFormFile>("multipart/form-data");

        group.MapDelete("/{documentId:guid}", async (
            Guid documentId,
            ClaimsPrincipal user,
            IDocumentDeleteService deleteService,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            if (tenantId == null)
                return Results.Unauthorized();

            try
            {
                await deleteService.DeleteDocumentAsync(documentId, tenantId.Value, ct);
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
        });

        return routes;
    }
}

