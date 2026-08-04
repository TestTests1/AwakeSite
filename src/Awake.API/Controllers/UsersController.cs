using Awake.API.Filters;
using Awake.Application.Features.Users.Commands.UpdateRank;
using Awake.Application.Features.Users.Queries.GetUsers;
using Awake.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Awake.API.Controllers;

public record UpdateRankRequest(UserRank NewRank);

[ApiController]
[Route("api/users")]
// Офицер и выше: у офицера есть своя ступень повышения — до участника.
// Кого именно он может тронуть, ограничивает UpdateUserRankCommandHandler.
[RankAuthorize(UserRank.Officer)]
public class UsersController(ISender sender) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var result = await sender.Send(new GetUsersQuery(), ct);
        return Ok(result);
    }

    [HttpPut("{id:guid}/rank")]
    public async Task<IActionResult> UpdateRank(Guid id, UpdateRankRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateUserRankCommand(id, request.NewRank), ct);
        return result.IsSuccess
            ? NoContent()
            : Problem(detail: result.Error, statusCode: StatusCodes.Status400BadRequest);
    }
}
