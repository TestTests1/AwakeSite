using Awake.API.Filters;
using Awake.Application.Features.Maps.Queries.GetMapModel;
using Awake.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Awake.API.Controllers;

[ApiController]
[Route("api/maps")]
[Authorize]
public class MapsController(ISender sender) : ControllerBase
{
    [HttpGet("{location}/model")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetModel(string location, CancellationToken ct)
    {
        var result = await sender.Send(new GetMapModelQuery(location), ct);
        if (!result.IsSuccess)
            return NotFound();

        // enableRangeProcessing: модели весят сотни мегабайт, докачка после
        // обрыва не должна начинаться с нуля
        return PhysicalFile(result.Value!, "model/gltf-binary", enableRangeProcessing: true);
    }
}
